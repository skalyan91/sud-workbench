"""Text → tokens, across parser engines.

Model ids are engine-qualified, ``"<engine>:<name>"``:

* ``sud:en_sud_ewt_gum`` — a Sunflower SUD spaCy package, loaded by its full name.
* ``stanza:fr``        — a Stanza UD model (optionally ``stanza:fr#gsd`` for a
                         specific treebank); it emits UD, which is converted to
                         SUD via grew (:mod:`app.convert`) so the editor stays SUD.
* ``""`` (empty)       — no model: whitespace tokenisation (a flat, unparsed table).

``parse`` always returns ``{"tokens", "mwt", "parsed", ...}``; on any
:class:`ParserUnavailable` it falls back to whitespace tokens with a ``reason``.
Legacy bare ids (``"en"``) resolve to a default SUD package via the registry.
"""

from __future__ import annotations

import difflib
import os
import sys
import threading

from . import convert
from .paths import STANZA_DIR


class ParserUnavailable(RuntimeError):
    """A requested engine/model can't run (not installed, or a needed step is missing)."""


def _tok(form, lemma="", upos="", xpos="", feats="", head="0", deprel="", misc="_"):
    return {
        "form": form, "lemma": lemma, "upos": upos, "xpos": xpos, "feats": feats,
        "head": str(head), "deprel": deprel, "deps": "_", "misc": misc or "_",
        "translit": "", "translitLemma": "",
    }


def whitespace_tokens(text: str) -> list[dict]:
    """Whitespace split into a flat, unparsed token table (root on the first token)."""
    forms = [f for f in text.strip().split() if f]
    if not forms:
        return [_tok("", head="0", deprel="root")]
    return [_tok(f, head="0" if j == 0 else "1", deprel="root" if j == 0 else "")
            for j, f in enumerate(forms)]


# ── PIPELINE ARMS ────────────────────────────────────────────────────────────────────────────────
# The options bar's Pipeline drawer, as the parser sees it: eight switchable arms, each named after
# the thing it fills in rather than after a spaCy component, because that is what the reader can check
# afterwards.  ``None`` means every arm — the default at every call site, so a caller that says
# nothing behaves exactly as it did before this existed.
#
# ⚠ **ONLY TWO OF THEM SKIP A COMPONENT; THE REST BLANK A COLUMN AFTERWARDS**, and that asymmetry is
# deliberate.  Skipping the morphologiser to turn FEATS off would also take UPOS with it (spaCy
# predicts the two as ONE joint label) and, on the generic parser, would degrade the SYNTAX as well —
# the parser there READS the FEATS the morphologiser has just written, which is the whole reason
# `package_generic_v2.sh` calls the pipeline order load-bearing.  A reader who unticks "Features" has
# asked for an empty FEATS column, not for a worse parse of the sentence, and those are different
# requests.  Blanking the column after the fact costs one component's runtime and has no
# cross-component consequence at all.  The two that ARE skipped have none either way: the parser
# (nothing downstream of it reads a tree the reader has just said they don't want) and the `sud_*`
# components, which only write extensions and are meaningless without that tree anyway.
#
# The frontend has two more arms — Transliteration and Glossing — which never reach this module:
# neither is the parser having an opinion, and both run with no model at all.  See AUTOREGEN's own
# note in js/core/prefs.js for the same distinction drawn for the same reason.
ARMS = ("tokenise", "sentence", "lemma", "upos", "xpos", "feats", "syntax", "sudmisc")
_ARM_COLUMN = {"lemma": "lemma", "upos": "upos", "xpos": "xpos", "feats": "feats"}

# ── WHICH COMPONENT OWNS WHICH ARM ───────────────────────────────────────────────────────────────
# Predicates rather than names, because a wheel may carry either lemmatiser and a clause parser is
# still a parser.  A component is switched OFF only when EVERY arm it owns is off — the morphologiser
# predicts UPOS and FEATS as one joint label, so unticking Features alone leaves it running and blanks
# the column afterwards (see the note above).
_ARM_PIPE = {
    "lemma":   lambda n: n in ("lemmatizer", "trainable_lemmatizer"),
    "upos":    lambda n: n == "morphologizer",
    "feats":   lambda n: n == "morphologizer",
    "xpos":    lambda n: n == "tagger",
    "syntax":  lambda n: n == "parser" or n.endswith("_parser"),
    # ⚠ `sud_require_upos` IS NOT A MISC ANNOTATOR, however its name sorts. It writes no column at
    # all — it is a GUARD the generic wheel ships to refuse a Doc whose UPOS is missing (see
    # _GUARD_PIPES). Left in this predicate it would have owned the `sudmisc` arm, so unticking "SUD
    # annotations" would have switched off the model's own contract check, and a custom model would
    # have gone back to parsing untagged text on the absent-feature row without saying so.
    "sudmisc": lambda n: n.startswith("sud_") and n not in _GUARD_PIPES,
}
# ── COMPONENTS THAT WRITE NOTHING AND REFUSE SOMETHING ───────────────────────────────────────────
# `sud_require_upos` raises for a Doc with an untagged token: "this arm READS UPOS and does not
# predict it -- tagging does not transfer across languages, which is why the column is yours to
# supply". That is the model stating its own contract, and it is a better statement of it than
# anything this app can infer — so it is read (`_needs_given_upos`, `model_arms`) rather than
# second-guessed. It is skipped only when the app has ALREADY decided not to ask for word classes, in
# which case the answer it would refuse is one nobody is going to be shown.
_GUARD_PIPES = {"sud_require_upos": "upos"}

# ── AND WHAT EACH ARM READS ──────────────────────────────────────────────────────────────────────
# ⚠ **SWITCHING AN ARM OFF MAKES EVERYTHING THAT READS IT INERT TOO**, so a reader never gets an
# answer computed from a column they just said they did not want.
#
# ⚠️ **AND "READS" MEANS WHAT THE COMPONENT'S ENCODER DECLARES, NOT WHERE IT SITS IN THE PIPELINE.**
# This was a hand-written table filtered by `pipe_names` ORDER, on the reasoning that a component
# cannot read what has not run yet.  That reasoning is sound as far as it goes — but it is a BOUND on
# what a component could be reading, not a statement of what it does read, and using it as one
# asserted two edges that do not exist and missed two that do, on the one wheel this app ships:
#
#   · `lemma ← upos` was ASSERTED for `en_sud_ewt_gum` because its lemmatiser follows its
#     morphologiser.  It is a `trainable_lemmatizer` — an `EditTreeLemmatizer` over its own
#     `HashEmbedCNN`, POS-BLIND by construction, which is exactly what `_force_upos`'s own docstring
#     already says ("its lemma will not move on a retag however the class is set").  Unticking Word
#     classes was blanking the lemmas over a dependency that is not there.
#   · `xpos ← upos, feats` was MISSED entirely.  That wheel's tagger runs on
#     `sud.Tok2VecPlusFeats.v1`, whose `feats_embed` declares `attrs=['POS']` plus seven FEATS names —
#     so XPOS really is conditioned on both, and unticking either left it computing from empty ones.
#   · `sudmisc ← lemma, upos, feats, syntax` was reduced to `← syntax`.  `sud_shared` embeds
#     `attrs=[NORM, PREFIX, SUFFIX, SHAPE, LEMMA, POS, DEP, MORPH, IS_QUOTE]`; four of those are
#     columns other arms write.
#   · `feats ← upos` on the generic parser needed a special case bolted on beside the table.  It needs
#     nothing: its morphologiser embeds `sud.GenericTagEmbed.v1(attrs=[…, POS])`, so the edge is there
#     to be read like every other one.
#
# So the graph is READ OFF THE MODEL — every `attrs` list, every `feats` list and every `upos_rows` in
# the component's own resolved config, mapped through `_ATTR_ARM` — and there is no pipeline order
# anywhere in it.  A wheel that changes what its tagger conditions on moves this by itself.
#
# NOT in the graph: `tokenise` and `sentence`.  Both have a defined non-model fallback that everything
# downstream consumes identically — a whitespace split and the rule sentence splitter — so switching
# one off SUBSTITUTES a segmentation rather than removing one, and parsing a segmentation the model
# did not produce is a first-class operation here, not a degraded one (`parse_pretokenized` exists for
# exactly that, and "SEGMENTATION IS THE ANNOTATOR'S" is the rule Reset Parse is built on).
_ATTR_ARM = {"POS": "upos", "MORPH": "feats", "TAG": "xpos", "LEMMA": "lemma",
             "DEP": "syntax", "HEAD": "syntax"}
# A RULE component declares no model to read this off, so what it consumes is stated here instead.
# `sud_reported_rule` and `sud_idiom` walk the TREE — that is what they are — and a wheel carrying one
# of them without the trainable `sud_shared` beside it would otherwise show no `sudmisc` edge at all.
_RULE_READS = {"sud_reported_rule": ("syntax",), "sud_idiom": ("syntax",),
               "sud_require_upos": ("upos",)}


def _arms_of(name: str) -> set:
    """The arms this component's output belongs to."""
    return {a for a, test in _ARM_PIPE.items() if test(name)}


def _cfg_reads(cfg, tok2vecs, depth: int = 0) -> set:
    """The arms whose columns a component's model config declares as INPUT features.

    Three shapes carry that, and all three are ordinary config keys rather than anything this has to
    reverse-engineer: ``attrs`` (spaCy's own ``MultiHashEmbed``/``HashEmbed`` attribute list, and the
    SUD kit's), ``feats`` (a list of FEATS NAMES, which is a MORPH read however it is spelled) and
    ``upos_rows`` (``sud.GenericEmbed.v2``'s own way of saying it hashes the word class).

    A ``Tok2VecListener`` reads whatever the tok2vec component it listens to reads, so it is followed
    through.  ``upstream`` names a component; the default ``"*"`` is resolved to the UNION of every
    tok2vec-ish component in the pipeline rather than to the nearest preceding one — spaCy's own rule
    there is positional, and a union is both position-free and conservative (a superset of what the
    listener could be reading, so the cascade errs towards keeping an arm live rather than silencing
    one that was fine)."""
    got: set = set()
    if depth > 12:
        return got                       # a listener chain that loops: stop rather than recurse for ever
    if isinstance(cfg, (list, tuple)):
        for v in cfg:
            got |= _cfg_reads(v, tok2vecs, depth + 1)
        return got
    if not isinstance(cfg, dict):
        return got
    if "Tok2VecListener" in str(cfg.get("@architectures") or ""):
        up = str(cfg.get("upstream") or "*")
        for nm, sub in tok2vecs.items():
            if up in ("*", nm):
                got |= _cfg_reads(sub, {}, depth + 1)   # {} — a tok2vec cannot itself listen
        return got
    for a in (cfg.get("attrs") or ()):
        arm = _ATTR_ARM.get(str(a).upper())
        if arm:
            got.add(arm)
    if cfg.get("feats"):
        got.add("feats")
    if cfg.get("upos_rows"):
        got.add("upos")
    for v in cfg.values():
        got |= _cfg_reads(v, tok2vecs, depth + 1)
    return got


def arm_deps(nlp) -> dict:
    """``{arm: [arms it reads]}`` for THIS model, read off the model.

    Handed to the frontend by ``Api.model_arms`` so the options bar can show an arm as inert when
    something it reads is switched off, and used by :func:`_pipe_plan` to do the same thing to the
    answer — one graph, so the drawer and the parse cannot disagree.

    Two edges are dropped, both because they would say nothing: a SELF-edge (the morphologiser reads
    POS and also writes it, which is a fact about how it is conditioned, not a prerequisite it can
    fail), and an edge onto an arm this pipeline has no component for at all — that column is empty
    for this model whatever anyone ticks, so treating it as a switch would make its dependants
    permanently inert on a state nobody can change.

    Never raises: a config shaped differently than expected yields no edges, which is the pre-cascade
    behaviour and the safe direction to fail in (an arm stays live rather than being silenced by a
    dependency this could not read)."""
    try:
        cfgs = nlp.config.get("components") or {}
        tok2vecs = {n: (cfgs.get(n) or {}).get("model")
                    for n in nlp.pipe_names
                    if str((cfgs.get(n) or {}).get("factory") or "") in ("tok2vec", "transformer")}
        owned = {a for n in nlp.pipe_names for a in _arms_of(n)}
        out: dict = {}
        for name in nlp.pipe_names:
            arms = _arms_of(name)
            if not arms:
                continue
            reads = _cfg_reads((cfgs.get(name) or {}).get("model"), tok2vecs)
            reads |= set(_RULE_READS.get(name, ()))
            for arm in arms:
                got = (reads - {arm}) & owned
                if got:
                    out[arm] = sorted(set(out.get(arm, ())) | got)
        return out
    except Exception:  # noqa: BLE001 — no edges is "nothing cascades", which is how this behaved before
        return {}


def _pipe_plan(nlp, arms: set, given: set = frozenset()) -> tuple:
    """``(components to skip, the arms that are really on)`` for one call.

    Two passes.  First the cascade: an arm whose prerequisite is off goes off too, to a fixpoint, so a
    chain (upos → feats → syntax → sudmisc) collapses in one step rather than one arm per parse.  Then
    the components: one is skipped when EVERY arm it owns is off, which for the generic parser means
    that switching off word classes takes its morphologiser — and, through the cascade, its parser —
    out of the run entirely rather than leaving them to compute an answer nobody will be shown."""
    eff = set(arms)
    # ⚠ A COLUMN THE ANNOTATOR SUPPLIED SATISFIES THE ARM FOR DEPENDENCY PURPOSES WITHOUT TURNING IT
    # BACK ON. The two facts are different and both matter: `have` is "is there a value here for a
    # component to read", which is what the cascade asks, while `eff` stays "is the MODEL writing this
    # column", which is what decides whether the component runs and whether the column is blanked. So
    # unticking Features on a re-parse leaves Syntax live — reading the annotator's own FEATS — where
    # it would go inert on a raw-text parse, and that is the honest difference between the two.
    have = eff | set(given)
    deps = arm_deps(nlp)
    changed = True
    while changed:                       # fixpoint: an arm may be dropped by an arm dropped this pass
        changed = False
        for arm, reads in deps.items():
            if arm in eff and any(r not in have for r in reads):
                eff.discard(arm)
                have.discard(arm)
                changed = True
    off = []
    for name in nlp.pipe_names:
        owners = _arms_of(name)
        if owners:
            if not (owners & eff):
                off.append(name)
            continue
        # A component that OWNS no arm is normally left alone — but a GUARD is skipped when the arm it
        # guards is off. Without this the generic wheel's `sud_require_upos` would raise on every
        # raw-text parse instead of the app returning the words with the columns it can honestly
        # fill; the reader would get an exception where the decision not to ask for word classes had
        # already been taken, two lines earlier, by this same function's caller.
        want = _GUARD_PIPES.get(name)
        if want and want not in eff:
            off.append(name)
    return off, eff


def _arms(arms) -> set:
    """Normalise an arms argument into a set.  ``None`` (or anything unrecognisable) = all of them,
    so no caller can accidentally disable an arm by passing a shape this doesn't understand."""
    if arms is None:
        return set(ARMS)
    try:
        got = {str(a) for a in arms}
    except TypeError:
        return set(ARMS)
    return got & set(ARMS)


def model_arms(model_id: str = "") -> list:
    """The arms a given model actually IMPLEMENTS — what the options bar greys out.

    An arm this list omits is not merely switched off: the model has nothing to say there, and the
    app falls back to what it does with no model at all (a whitespace split, the rule sentence
    splitter, an empty column).  A custom model's answer is `generic_models.GENERIC_ARMS`, which is
    the wheel's own account of what it ships and why each absence is deliberate; everything else
    reports whatever its pipeline can be seen to contain, so a wheel that gains or loses a component
    changes this without anyone editing a table here."""
    if not model_id:
        return []
    try:
        engine, name, tb_lang = _resolve_model(model_id)
    except ParserUnavailable:
        return []
    # Keyed on the PACKAGE, not on the id: `custom:<slug>` and the bare `sud:xx_sud_generic` name the
    # same pipeline, and it is the pipeline that ships no tokeniser, no tagger and no lemmatiser. The
    # bare id is not selectable in the model dropdown today (models_registry.GENERIC_SUD keeps it out
    # of every language listing), but answering differently for the two ids would be a trap for
    # whatever reaches it next — `_needs_given_upos` reads this function, so the difference would show
    # up as one of them silently inventing word classes.
    from . import generic_models
    if tb_lang is not None or name == generic_models.GENERIC_PKG:
        return sorted(generic_models.GENERIC_ARMS)
    if engine == "stanza":
        # A full Stanza UD pipeline segments, tokenises, tags, lemmatises and parses; the SUD MISC
        # layer is a SUD wheel's own and survives no UD→SUD conversion, so it is the one absence.
        return sorted(set(ARMS) - {"sudmisc"})
    if engine != "sud":
        from . import models_registry
        name = models_registry.resolve_default_package(model_id) or ""
    if not name:
        return []
    try:
        pipes = set(_load_spacy(name).pipe_names)
    except Exception:  # noqa: BLE001 — not installed: claim nothing rather than guess
        return []
    got = {"tokenise", "sentence"}          # every SUD wheel carries a real tokeniser
    if pipes & {"lemmatizer", "trainable_lemmatizer"}:
        got.add("lemma")
    if "tagger" in pipes:
        got.add("xpos")
    if "morphologizer" in pipes:
        got |= {"upos", "feats"}            # ONE joint label predicts both — see _force_upos
    if any(p == "parser" or p.endswith("_parser") for p in pipes):
        got.add("syntax")
    if any(p.startswith("sud_") and p not in _GUARD_PIPES for p in pipes):
        got.add("sudmisc")
    # ⚠ A GUARD TAKES ITS ARM OUT OF THE OUTPUT SET. A morphologiser predicts UPOS and FEATS as one
    # joint label, so the clause above claims both — but a wheel shipping `sud_require_upos` is
    # saying in as many words that the class is its INPUT and it does not predict one. Read off the
    # pipeline rather than keyed to a package, so a future wheel that declares the same contract is
    # covered with nothing here to edit. (The generic package's own entry above says the same thing
    # and is kept as the floor: it is a fact about what the arm was TRAINED to do, and it still holds
    # for a copy of the wheel installed before this component existed.)
    for guard, arm in _GUARD_PIPES.items():
        if guard in pipes:
            got.discard(arm)
    return sorted(got & set(ARMS))


# An arm whose absence has a real FALLBACK rather than an empty column: with no model tokeniser the
# text is split on whitespace, with no model sentence splitter the app's rule splitter runs.  Every
# other arm's absence means "this column stays empty", which is a different thing and is why
# `_effective_arms` treats the two groups differently.
_FALLBACK_ARMS = frozenset({"sentence"})


def _effective_arms(model_id: str, arms) -> set:
    """The reader's arms narrowed to what this model can actually do.

    ⚠ **THE INTERSECTION HAPPENS HERE, NOT ONLY IN THE OPTIONS BAR.**  The drawer greys an arm the
    model lacks and `pipeArms()` already drops it, so this is belt to that pair of braces — but it is
    also the only place a caller that never saw the drawer (a batch insert, a headless run, a future
    bridge method) is covered.  Without it, a model with no UPOS tagger returns whatever its
    morphologiser guessed in a column the app then saves as annotation, and the reader has no way to
    tell that answer from one the model was actually trained to give.

    ``sentence`` is exempt: its absence routes to the rule splitter, not to an unsplit paragraph, and
    a reader who leaves the box ticked is asking for sentences, not for the model specifically."""
    got = _arms(arms)
    try:
        can = set(model_arms(model_id))
    except Exception:  # noqa: BLE001 — a model that cannot be inspected will fail its own parse next
        return got
    if not can:
        return got
    return {a for a in got if a in can or a in _FALLBACK_ARMS}


def _needs_given_upos(model_id: str) -> bool:
    """Whether this model reads UPOS as an INPUT it cannot supply for itself.

    ⚠ THE GENERIC PARSER DOES, AND THAT CHANGES WHAT A RAW-TEXT PARSE MAY CLAIM.  "You supply UPOS;
    the wheel supplies everything else" is the pipeline's stated contract — tagging is lexical and
    upstream measured that it does not transfer (32-39 % over held-out languages, no better than a
    single English tagger).  So the morphologiser, handed a Doc with no word classes on it, invents
    some: on an untagged Basque sentence it returned DET for every token, and the parser then read
    THAT and produced a tree conditioned on it.  The tree parsed, the columns filled, and the whole
    answer was about a sentence nobody had described.

    Silence is the preferred failure for annotation (CLAUDE.md), so where this is true and no UPOS
    has been given, `syntax` and `feats` are dropped and the caller is told why.  Supply the word
    classes — which `reparseTokenFields` does after any edit, and which `reparse` now does too for
    exactly these models — and both arms come back.

    ⚠ AN EMPTY ANSWER IS "DON'T KNOW", NOT "HAS NO TAGGER".  `model_arms` returns `[]` for a model it
    could not inspect at all — not installed, an unknown id, a pipeline that failed to load — and a
    bare `"upos" not in set(...)` reads that as true, which would strike the syntax off every parse
    whose model this function merely could not see.  Those parses fail on their own a moment later,
    with their own reason; they must not first be quietly relabelled as this one."""
    can = set(model_arms(model_id))
    return bool(can) and "upos" not in can


def _apply_arms(tokens: list[dict], arms: set, given: set = frozenset()) -> list[dict]:
    """Empty the columns whose arm is off, in place.

    A disabled column comes back EMPTY rather than carrying the model's answer unshown: the token
    dicts are the document, they are what gets saved, and "the parser filled this in but the app is
    hiding it" would be a lie the CoNLL-U file on disk then tells for ever."""
    for key, col in _ARM_COLUMN.items():
        # ⚠ …BUT NEVER A COLUMN THE CALLER SUPPLIED. Blanking an off arm is right when the model
        # simply did not write it; here the ANNOTATOR wrote it, handed it in as input, and is about to
        # have this answer merged back over their own tokens. Emptying it would delete the very
        # annotation the parse was conditioned on — the same fault the `upos` restore below was
        # written for, arriving by a different door.
        if key not in arms and key not in given:
            for t in tokens:
                t[col] = ""
    if "syntax" not in arms:
        # The same flat, unparsed shape `whitespace_tokens` produces — head 0 on the first token, no
        # relation on the rest — rather than heads left at whatever a skipped parser never wrote.
        for j, t in enumerate(tokens):
            t["head"] = "0" if j == 0 else "1"
            t["deprel"] = "root" if j == 0 else ""
    return tokens


# ── CUSTOM MODELS: one shared wheel, one embedding row each ──────────────────────────────────────
def _resolve_model(model_id: str) -> tuple:
    """``(engine, name, tb_lang)`` for any model id, custom ones included.

    A ``custom:<slug>`` id is not a package of its own — it is the shared generic wheel plus the
    ``Doc._.tb_lang`` that selects this model's row of its embedding table (see app/generic_models.py).
    Resolving it HERE, once, is what lets every ``engine == "sud"`` branch below go on working
    unchanged: a custom model IS a SUD spaCy model, differing only in which vector it reads."""
    engine, _, name = (model_id or "").partition(":")
    if engine == "custom" and name:
        from . import generic_models
        tb = generic_models.tb_lang_for(model_id)
        if not tb:
            raise ParserUnavailable(f"no such custom model: {name!r}")
        return "sud", generic_models.GENERIC_PKG, tb
    return engine, name, None


# ── WHAT THE ANNOTATOR IS SUPPLYING ──────────────────────────────────────────────────────────────
# ⚠ **AN ARM THAT IS OFF IS ONE THE ANNOTATOR HAS TAKEN OVER.** The model will not write that column,
# so the column is theirs — and every component that READS it should read theirs. That is the same
# `arm_deps` graph as the cascade, followed in the other direction: not "Syntax is inert because
# Features is off" but "Syntax reads the Features you supplied". It is also the rule already in force
# for UPOS on a model that cannot tag, generalised from that one column to all of them.
#
# ⚠️ AND IT IS WORTH MORE THAN ANY SECOND PARSER WOULD BE. Measured on ten held-out Basque sentences
# through this app's own scorer: UPOS alone gives LAS 38.32, UPOS + FEATS gives **53.27** (+14.95),
# which reproduces upstream's own table (Georgian 55.00 → 69.27, Basque 43.48 → 53.42). Ensembling
# the generic arm with a monolingual wheel buys nothing by comparison — where both exist the wheel is
# 20-35 LAS better and the weaker model only drags, and where only the generic one exists there is
# nothing to ensemble with, because a borrowed tagger reaches 32-39 % UPOS on a language it was not
# trained on and wrong word classes cost about half a LAS point each. The annotator is the second
# model, and a far better one.
_GIVEN_SETTER = {
    "upos":  lambda tok, v: setattr(tok, "pos_", v),
    "feats": lambda tok, v: tok.set_morph(v),
    "lemma": lambda tok, v: setattr(tok, "lemma_", v),
    "xpos":  lambda tok, v: setattr(tok, "tag_", v),
}


def _given_arms(given) -> set:
    """The arms the caller is supplying a real value for, ignoring empty columns."""
    if not isinstance(given, dict):
        return set()
    return {a for a, col in given.items()
            if a in _GIVEN_SETTER and any(v and v != "_" for v in (col or ()))}


def _given_doc(nlp, forms, tb_lang, upos=None, given=None):
    """A Doc carrying everything the CALLER is supplying, before any component runs.

    ⚠ **THE WORD CLASSES GO ON HERE, NOT AFTER THE MORPHOLOGISER.** `_force_upos` has always applied
    them at that later point, which was enough while it was only being used to CONSTRAIN a model that
    tags for itself. It is not enough for a model that reads them: `sud_require_upos` runs FIRST and
    refuses a Doc with an untagged token, so a call that set them three components later got the
    wheel's own refusal for tags it was in the middle of supplying. It is also simply the right
    moment — the generic morphologiser embeds `attrs=[…, POS]`, so a class arriving after it has run
    is a class it never conditioned on.

    `_force_upos` still runs where it always did, and still earns its place: it re-derives the FEATS
    for the chosen class from the model's own joint label, which setting `pos_` cannot do.

    ``given`` carries the other columns the annotator owns (see the note above), each applied the same
    way and at the same moment.  ``upos`` stays a parameter of its own because it means something
    slightly different: ``given`` is "the model is not writing this, so read mine", where ``upos`` is
    "the model may write this, but CONSTRAIN it to mine" — the retag case `_force_upos` exists for."""
    from spacy.tokens import Doc
    doc = _tb(Doc(nlp.vocab, words=forms), tb_lang)
    for i, want in enumerate(upos or ()):
        if want and want != "_" and i < len(doc):
            doc[i].pos_ = want
    for arm, col in (given or {}).items():
        setter = _GIVEN_SETTER.get(arm)
        if setter is None:
            continue
        for i, val in enumerate(col or ()):
            if val and val != "_" and i < len(doc):
                try:
                    setter(doc[i], val)
                except Exception:  # noqa: BLE001 — a value this vocab cannot take (a malformed FEATS
                    pass           # string) is the annotator's to fix, not a reason to fail the parse
    return doc


def _tb(doc, tb_lang):
    """Stamp a Doc with the language row a custom model reads, before any component runs.

    ⚠ IT MUST BE SET ON THE DOC, NOT PASSED TO THE PIPELINE, and it must be set BEFORE the first
    component: `sud.GenericEmbed.v2`'s `LangSlotExtractor` reads `Doc._.tb_lang` on every forward
    pass and RAISES for a language it has no slot for, deliberately — "a default row would silently
    give it some training language's vector"."""
    if tb_lang:
        doc._.tb_lang = tb_lang
    return doc


# ── engine caches (each model loaded at most once per session) ────────────────
_SPACY_MODELS: dict[str, object] = {}
_STANZA_PIPES: dict[str, object] = {}
_STANZA_TOK_PIPES: dict[str, object] = {}   # tokenise-only Stanza pipelines (the fast first step)


def invalidate_cache(pkg: str | None = None) -> None:
    """Drop loaded models — call after installing/removing a model package.

    ``pkg``, when given, ALSO purges ``sys.modules`` for that SPECIFIC Python package (and any of
    its own submodules) — on report ("updating the Sanskrit parser seems to have no effect"):
    clearing ``_SPACY_MODELS`` alone drops the WRAPPER ``nlp`` object this file caches, but
    ``spacy.load(package)`` for a package-name model (every SUD model) re-imports ``package`` as an
    ordinary Python module underneath — and Python's OWN import system (``sys.modules``,
    process-wide, unrelated to the dicts above) does NOT re-read a module's files once it has
    already been imported once in this process. So a genuinely-reinstalled model, already parsed
    with once this session, kept running the STALE code already sitting in memory from before the
    update, even though the files on disk (and this file's own wrapper cache) were both correctly
    fresh. Only THIS ONE package's modules are dropped, not a blanket ``sys.modules`` sweep, so an
    unrelated already-loaded model is undisturbed. Stanza models have no comparable exposure — they
    are data files a shared library loads at runtime, not a separately-imported Python package per
    model — so the two Stanza call sites below pass no ``pkg`` and behave exactly as before."""
    _SPACY_MODELS.clear()
    _STANZA_PIPES.clear()
    _STANZA_TOK_PIPES.clear()
    if pkg:
        for name in [n for n in sys.modules if n == pkg or n.startswith(pkg + ".")]:
            del sys.modules[name]


# ⚠ ONE LOAD AT A TIME, because the warm-up below made this reentrant for the first time. Until it
# existed, every `spacy.load` here ran on whichever single thread was parsing; now a background warm
# and a reader's own first parse can arrive together, and without this both would call `spacy.load`
# for the same package — transiently DOUBLE the model's memory, for one of the two to be thrown away
# when it lost the dict assignment. Double-checked inside the lock so the warm path costs a lock
# acquisition once and a dict hit for ever after.
_LOAD_LOCK = threading.Lock()


def _load_spacy(package: str):
    if package in _SPACY_MODELS:
        return _SPACY_MODELS[package]
    with _LOAD_LOCK:
        if package in _SPACY_MODELS:   # another thread loaded it while we waited
            return _SPACY_MODELS[package]
        return _load_spacy_locked(package)


def _load_spacy_locked(package: str):
    try:
        import spacy
    except ImportError as exc:
        raise ParserUnavailable("spaCy is not installed") from exc
    try:
        nlp = spacy.load(package)
    except Exception as exc:  # noqa: BLE001
        # …AND THE REASON TRAVELS WITH IT, exactly as in `_load_stanza`. `spacy.load` raises OSError
        # for a genuinely absent model, but every failure inside the pipeline's OWN code lands here
        # too — and the commonest is a bundled tokeniser whose dependency is missing, which raises
        # ModuleNotFoundError (`zh_sud_gsd_simp_trad` imports jieba). Reporting that as "not
        # installed" sends the reader hunting for a model that is sitting on disk, correctly
        # installed; the one thing they need to know is the name of the module that was absent.
        why = f"{type(exc).__name__}: {exc}".strip(": ")
        raise ParserUnavailable(
            f"model {package!r} could not be loaded (is it installed?) — {why}") from exc
    # A CUSTOM MODEL'S ROW IS PART OF THE PIPELINE, so it is written in before anything can parse
    # with it — not on first use, where a cache hit would skip it. Cheap (128 floats per model per
    # embedding table) and total: `apply_to` also CLEARS any `custom:` key the table does not have a
    # stored row for, so a freshly-loaded pipeline can never carry a slot for a model that was
    # removed while it was cached out.
    if package == "xx_sud_generic":
        try:
            from . import generic_models
            generic_models.apply_to(nlp)
        except Exception as exc:  # noqa: BLE001 — the generic wheel still parses its 80 built-in languages
            print(f"[custom] rows not applied: {exc}", file=sys.stderr)
    _SPACY_MODELS[package] = nlp
    return nlp


def warm(model_id: str = "") -> bool:
    """Load ``model_id``'s pipeline into this process's cache and answer whether it is there.

    ⚠ EXISTS BECAUSE THE FIRST PARSE OF A SESSION IS THE EXPENSIVE ONE AND THE READER SHOULD NOT BE
    THE ONE WAITING FOR IT. Measured: loading ``en_sud_ewt_gum`` is **8.4 s**, against 0.3 s for the
    parse itself once it is loaded. Two features pay that toll on their FIRST use and both are
    English-model features whatever language the document is in — the translation auto-gloss
    (:mod:`app.gloss_align`) and the Wiktionary definition flyout (:mod:`app.wiktionary`, which
    condenses English definition prose). Called from a background thread at launch, so the cost is
    paid while the reader is reading rather than after they have asked for something.

    Never raises and never reports a problem anywhere: a machine with no English model installed is
    an ordinary state (the wheel is a declared dependency, but a trimmed or half-built environment
    may lack it), and a warm-up is by definition something nobody asked for -- there is no one to
    tell. The real call sites resolve the model themselves and report their own absence properly."""
    try:
        engine, name, _tb_lang = _resolve_model(model_id)
        if engine != "sud" or not name:
            return False
        _load_spacy(name)
        return True
    except Exception:  # noqa: BLE001 — a warm-up must never be able to take the app down with it
        return False


def _spacy_doc_to_sud(doc, arms: set | None = None) -> tuple[list[dict], list[dict]]:
    """Turn a PARSED spaCy Doc into a SUD token table + MWT ranges (heads/relations/POS/lemma/
    features), factored out of `_parse_spacy_sud`."""
    words = list(doc)
    index = {t.i: pos for pos, t in enumerate(words)}
    out = []
    space_after = []
    for t in words:
        is_root = t.dep_ in ("root", "ROOT") or t.head.i == t.i
        head = "0" if is_root else str(index[t.head.i] + 1)
        deprel = "root" if is_root else (t.dep_ or "")
        out.append(_tok(t.text, t.lemma_ or "", t.pos_ or "", t.tag_ or "",
                        str(t.morph) if t.morph else "", head, deprel,
                        misc=_ext_misc(t, arms=arms)))
        space_after.append(t.whitespace_ != "")
    if not out:
        return [], []
    # Three answers about the MWT ranges, most authoritative first: the ranges the tokeniser
    # PUBLISHED, the ranges its published source spans IMPLY, and — for a tokeniser that says
    # nothing at all — the whitespace/PUNCT heuristic. Only the last is a guess.
    mwt = _mwt_from_doc(doc, out)
    if mwt is None:
        layout = _src_span_layout(doc, out)
        if layout is not None:
            mwt, space_after = layout        # the RAW text's spacing, not the reconstruction's
    if mwt is None:
        mwt = _reconstruct_mwt(out, space_after)
    else:
        _mark_space_after(out, space_after, mwt)
    return out, mwt


def _parse_spacy_sud(text: str, package: str, tb_lang=None,
                     arms: set | None = None) -> tuple[list[dict], list[dict]]:
    nlp = _load_spacy(package)
    arms = set(ARMS) if arms is None else arms
    try:
        # The Doc is built and STAMPED before the pipeline runs, rather than handed to `nlp(text)`:
        # a custom model's embedding row is selected by `Doc._.tb_lang`, and the first component to
        # look for it raises if it is not there (see `_tb`). `nlp.tokenizer(text)` is exactly the
        # step `nlp(text)` would have taken first, so nothing else about the call changes.
        # …and with TOKENISATION off, the tokeniser is not what decides the words: a whitespace split
        # is, and the rest of the pipeline runs over that. That is what the arm means, and it is the
        # only honest reading of it — a "tokenisation off" that still let the model re-segment would
        # be a switch that does nothing.
        if "tokenise" in arms:
            doc = nlp.tokenizer(text)
        else:
            from spacy.tokens import Doc
            words = [f for f in text.strip().split() if f] or [text.strip()]
            doc = Doc(nlp.vocab, words=words)
        _tb(doc, tb_lang)
        off, arms = _pipe_plan(nlp, arms)
        for name, proc in nlp.pipeline:
            if name in off:
                continue
            doc = proc(doc)
    except Exception as exc:  # noqa: BLE001 — e.g. a raw-text tokeniser dependency isn't installed yet
        raise ParserUnavailable(str(exc)) from exc
    out, mwt = _spacy_doc_to_sud(doc, arms)
    return (_apply_arms(out, arms), mwt) if out else (whitespace_tokens(text), [])


def _spacy_tokenize(text: str, package: str) -> tuple[list[dict], list[bool], list[dict]]:
    """Run ONLY the spaCy tokeniser (no tagging/parsing) → a flat, unparsed token table plus
    the per-token SpaceAfter flags. This is the fast first step of tokenise → transliterate →
    parse, so the tokens (and their transliterations) appear before the heavy parse runs. The
    SpaceAfter flags are handed back so the follow-up parse can rebuild the very same Doc.

    Also returns any MWT ranges the tokeniser published (`_mwt_from_doc`) or that its published
    source spans imply (`_src_span_layout`), so a morphologically tokenised language shows its
    ranges in the preview rather than having them pop in when the parse lands. `_reconstruct_mwt` is
    NOT run here: nothing has tagged yet, so its PUNCT test has no input — the two published answers
    are the only ones available this early, which is why the preview used to return none at all."""
    nlp = _load_spacy(package)
    try:
        doc = nlp.tokenizer(text)
    except Exception as exc:  # noqa: BLE001
        raise ParserUnavailable(str(exc)) from exc
    forms = [t.text for t in doc]
    spaces = [t.whitespace_ != "" for t in doc]
    if not forms:
        return whitespace_tokens(text), [], []
    toks = [_tok(f, head="0" if j == 0 else "1", deprel="root" if j == 0 else "")
            for j, f in enumerate(forms)]
    mwt = _mwt_from_doc(doc, toks)
    if mwt is None:
        layout = _src_span_layout(doc, toks)
        if layout is not None:
            mwt, spaces = layout      # a rewriting tokeniser's own text has the wrong spacing
    for i, sa in enumerate(spaces):   # keep a spaceless join (clitics, CJK) visible in the preview
        if not sa and i < len(toks) - 1:
            toks[i]["misc"] = "SpaceAfter=No"
    return toks, spaces, mwt or []


def _mwt_from_doc(doc, tokens: list[dict]) -> list[dict] | None:
    """The MWT ranges a tokeniser published for itself, if it published any.

    A tokeniser that splits one orthographic word into several tokens already *knows* the
    grouping — it did the splitting — so re-deriving it with `_reconstruct_mwt` below throws
    away certainty and replaces it with a guess that reads the **tagger's** PUNCT decisions
    (an MWT can then appear or vanish on a tagging slip: English ``e-mail`` groups because the
    hyphen came back NOUN, while ``co-op`` doesn't because its hyphen came back PUNCT).  The
    convention is ``doc.user_data["mwt_ranges"] = [(first, last, surface), …]``, 1-based and
    inclusive over the doc's own tokens, alongside ``doc.user_data["source_text"]`` — the raw
    input, which a word-list-built Doc no longer carries in ``doc.text``.

    Keyed on the key's PRESENCE, not on the document language, so any morphologically-tokenising
    model opts in by publishing it (``ar_sud_padt``'s CAMeL tokeniser is the first). ``None``
    means the tokeniser said nothing → infer; ``[]`` is a positive "this text has no MWTs" and
    is honoured as such (which is what stops the whitespace heuristic from fabricating ranges
    out of character runs in a spaceless script that happens to contain spaces)."""
    raw = getattr(doc, "user_data", None) or {}
    raw = raw.get("mwt_ranges")
    if raw is None:
        return None
    mwt = []
    for item in raw:
        try:
            a, b, form = int(item[0]), int(item[1]), str(item[2])
        except (TypeError, ValueError, IndexError, KeyError):
            continue                      # one malformed range must not sink the whole parse
        if not 1 <= a < b <= len(tokens):
            continue                      # out of range, or a single token — neither is an MWT
        mwt.append({"from": a, "to": b, "form": form,
                    "_cols": [f"{a}-{b}", form, "_", "_", "_", "_", "_", "_", "_", "_"]})
    mwt.sort(key=lambda m: m["from"])
    return mwt


def _is_punct_form(form: str) -> bool:
    """A token made of nothing but punctuation. Used where `_reconstruct_mwt`'s UPOS test can't be:
    the tokenise-only path has no tagger output yet, and a daṇḍa run glued to the word before it
    (``raviḥ‖``) has to be kept out of that word's range all the same."""
    return bool(form) and not any(ch.isalnum() for ch in form)


def _src_span_layout(doc, tokens: list[dict]) -> tuple[list[dict], list[bool]] | None:
    """MWT ranges and SpaceAfter flags read off a tokeniser's PUBLISHED source spans, or ``None``.

    Sits between the two existing answers (`_mwt_from_doc`'s explicit ``mwt_ranges`` and
    `_reconstruct_mwt`'s heuristic) and is better than the heuristic for the same reason the
    explicit list is: it is not a guess. A tokeniser that publishes ``doc._.src_text`` +
    ``doc._.src_spans`` has told us where every token came from in the RAW input, and an
    orthographic word is just a run of tokens whose spans fall in one whitespace-delimited chunk of
    that input — which is precisely what a multi-word token is. `sa_sud_vedic_ufal_dcs` is the case
    this exists for; any future splitter that publishes spans gets it for nothing.

    Two things it gets right that `_reconstruct_mwt` cannot:

    · **The range's FORM is the raw substring**, not the concatenation of the components. Those
      differ exactly where a sandhi splitter earns its keep — ``vartmā`` + ``punar-`` is stored as
      the two words ``vartma`` and ``a``, whose concatenation ``vartmaa`` is not a word in any
      script. Taking the substring instead is what lets the frontend's literal-match alignment
      settle the sentence with no bridge call at all.
    · **SpaceAfter comes from the RAW text.** ``doc.text`` here is the tokeniser's RECONSTRUCTION,
      and it puts spaces where the input had none (the CSLiser splits ``vartmāpunarjanmanām`` into
      three space-separated pieces), so ``token.whitespace_`` would report gluing that the file must
      not record. Two tokens are glued iff their spans meet or overlap in the input.

    A token the tokeniser could not place (a ``None`` span) inherits its neighbour's chunk rather
    than breaking the run: it is a gap in the OFFSETS, not evidence of a word boundary — the
    Devanagari path produces one on the coalesced particle of every ``vartmā``-type junction, and
    treating it as a boundary would split the orthographic word in half."""
    try:
        from spacy.tokens import Doc
        if not (Doc.has_extension("src_text") and Doc.has_extension("src_spans")):
            return None
        text = doc._.src_text
        spans = doc._.src_spans
        if not text or not spans or len(spans) != len(doc) or len(doc) != len(tokens):
            return None
        # chunk id per character of the raw input; -1 on whitespace, so a span start names its word
        chunk_at, cid, prev_ws = [], -1, True
        for ch in text:
            if ch.isspace():
                chunk_at.append(-1)
                prev_ws = True
            else:
                if prev_ws:
                    cid += 1
                chunk_at.append(cid)
                prev_ws = False
        norm: list[tuple[int, int] | None] = []
        for sp in spans:
            try:
                a, b = int(sp[0]), int(sp[1])
            except (TypeError, ValueError, IndexError):
                norm.append(None)
                continue
            norm.append((a, b) if 0 <= a < b <= len(text) else None)
        if not any(norm):
            return None
        # each token's chunk, with an unplaced token borrowing from the nearest placed neighbour
        chunk_of: list[int] = [chunk_at[sp[0]] if sp else -1 for sp in norm]
        for i, sp in enumerate(norm):
            if sp:
                continue
            # only borrow when BOTH sides agree, or only one side exists: a hole between two
            # different words is a boundary we cannot see, and guessing either way invents a range
            left = next((chunk_of[t] for t in range(i - 1, -1, -1) if norm[t]), -1)
            right = next((chunk_of[t] for t in range(i + 1, len(norm)) if norm[t]), -1)
            chunk_of[i] = left if right < 0 else (right if left < 0 else
                                                  (left if left == right else -1))
        # glued-to-next: the spans meet or overlap (they overlap by one character at a coalescence)
        space_after = []
        for i in range(len(norm)):
            a, b = norm[i], (norm[i + 1] if i + 1 < len(norm) else None)
            space_after.append(True if not a or not b else b[0] > a[1])
        if space_after:
            space_after[-1] = False
        mwt: list[dict] = []
        i = 0
        while i < len(tokens):
            j = i
            while (j + 1 < len(tokens) and chunk_of[j + 1] >= 0
                   and chunk_of[j + 1] == chunk_of[i]):
                j += 1
            if chunk_of[i] >= 0:      # one orthographic word: split it on punctuation runs
                k = i
                while k <= j:
                    if _is_punct_form(tokens[k]["form"]):
                        k += 1
                        continue
                    e = k
                    while e + 1 <= j and not _is_punct_form(tokens[e + 1]["form"]):
                        e += 1
                    if e > k:
                        placed: list[tuple[int, int]] = [sp for sp in norm[k:e + 1] if sp is not None]
                        a = placed[0][0] if placed else -1
                        b = placed[-1][1] if placed else -1
                        form = text[a:b] if b > a >= 0 else \
                            "".join(tokens[t]["form"] for t in range(k, e + 1))
                        mwt.append({"from": k + 1, "to": e + 1, "form": form,
                                    "_cols": [f"{k + 1}-{e + 1}", form,
                                              "_", "_", "_", "_", "_", "_", "_", "_"]})
                    k = e + 1
            i = j + 1
        return mwt, space_after
    except Exception:  # noqa: BLE001 — an unexpected extension shape falls through to the heuristic
        return None


# The spaCy extensions a SUD model may set on a token beyond the ten CoNLL-U columns, and the MISC
# key each rides in.  All three are UD conventions rather than inventions of ours: a non-Latin-script
# treebank puts the native script in FORM/LEMMA and the romanisation in `Translit`/`LTranslit`
# (`sa_sud_vedic_ufal_dcs`'s `sa_deva` component does exactly that for a Devanagari input), and the
# Vedic treebank records the padapāṭha in `Unsandhied` on 100 % of its tokens — the DCS
# representation leaves a standalone word SANDHIED in FORM, so without this key the unsandhied
# analysis the model predicts would simply be discarded.  MISC is the right home for all three: they
# are annotation layers on a token, they round-trip through the file untouched, and none of them is
# the FORM.
_TOKEN_MISC_EXT = (("translit", "Translit"), ("ltranslit", "LTranslit"),
                   ("unsandhied", "Unsandhied"))

# SUD's OWN MISC LAYER, which the released parsers predict with components of their own
# (`sud_subject`/`sud_subject_rule`, `sud_reported_rule`, `sud_idiom`) and publish on a SINGLE
# extension, `Token._.sud_misc` — a dict, not a string, so it needs its own fold rather than another
# `_TOKEN_MISC_EXT` row.  Four keys, and the app already draws three of the four analyses they name:
#
#   Subject=SubjRaising|ObjRaising|…  the embedded predicate whose subject is raised — the ghost edge
#                                     `subjGhostTarget` draws (js/diagram/diagram-edit.js)
#   Reported=Yes                      a verbatim-speech complement — `isReported`, drawn as a subtree
#                                     lifted off the line (js/diagram/diagram-core.js)
#   Idiom=Yes / InIdiom=Yes           the head of a SUD idiom (it also carries `ExtPos`) and its other
#                                     members (they attach by `unk`)
#
# Upstream deliberately keeps these OUT of `token.morph`, so a MISC feature never masquerades as a
# morphological one; MISC is where the treebanks put all four, and where this app's own hand-annotation
# of `Subject`/`Reported` already lives (raiseGet/raiseSet, js/core/prefs.js).  Not every wheel carries
# every key — the split is empirical, per language, and recorded in SUD-spaCy's own CLAUDE.md (zh ships
# no `Subject`; fa/la ship no `Reported`; the four non-idiom-annotating treebanks ship no `Idiom`) — so
# an absent key means "this model says nothing here", never "no".
_SUD_MISC_KEYS = ("Idiom", "InIdiom", "Reported", "Subject")


def _ext_misc(tok, misc: str = "_", arms: set | None = None) -> str:
    """``misc`` with whatever `_TOKEN_MISC_EXT` / `sud_misc` values this token carries folded in.

    Silent about extensions that are not registered (every model but the Sanskrit one, and every
    model packaged before the SUD MISC layer existed) and about empty values, so a model that
    publishes none leaves MISC exactly as it was.

    With the **SUD annotations** arm off, `_SUD_MISC_KEYS` are not folded in even where a component
    somehow wrote them — the arm already skips those components (`_pipe_plan`), and this is the
    belt to that pair of braces. `_TOKEN_MISC_EXT` is NOT gated with them: those are the tokeniser's
    own facts about the token (transliteration, source offsets), not the parser having an opinion."""
    parts = [p for p in (misc or "").split("|") if p and p != "_"]
    have = {p.split("=", 1)[0] for p in parts}
    try:
        from spacy.tokens import Token
        for attr, key in _TOKEN_MISC_EXT:
            if key in have or not Token.has_extension(attr):
                continue
            val = getattr(tok._, attr, "") or ""
            if val:
                parts.append(f"{key}={val}")
        if Token.has_extension("sud_misc") and (arms is None or "sudmisc" in arms):
            sud = getattr(tok._, "sud_misc", None) or {}
            for key in _SUD_MISC_KEYS:            # a fixed order, not the dict's: MISC is a set of
                val = str(sud.get(key) or "")     # key=value pairs and the file should not record
                if val and key not in have:       # which component happened to run first
                    parts.append(f"{key}={val}")
    except Exception:  # noqa: BLE001
        pass
    return "|".join(parts) if parts else "_"


def _add_space_after_no(misc: str | None) -> str:
    """Append SpaceAfter=No to a MISC field, idempotently."""
    if not misc or misc == "_":
        return "SpaceAfter=No"
    return misc if "SpaceAfter=No" in misc.split("|") else misc + "|SpaceAfter=No"


def _mark_space_after(tokens: list[dict], space_after: list[bool], mwt: list[dict]) -> None:
    """Mark SpaceAfter=No wherever a token is glued to what follows.

    An MWT range moves where the flag BELONGS, so there are three cases, not two:

    · STRICTLY INSIDE a range — nothing is written. The surface of those words is the range's own
      FORM, so the gluing is implied by the range itself.
    · on a range's LAST component — the join is to a token OUTSIDE the range, and UD records it on
      the RANGE line (MISC = ``_cols[9]``), not on the component. This is the case the earlier
      ``covered`` set got wrong: it excluded every component including the last, so nothing was
      written at all and ``The co-op sent an e-mail.`` came back with no way to tell that the ``.``
      was glued to ``e-mail`` — the sentence re-read with a space before the full stop. Writing it
      on the component instead would be equally lost: `io_conllu` rebuilds the surface from the
      range line and never consults a component's MISC.
    · anywhere else — on the token, as before.

    The Stanza path (`_stanza_ud`) does not come through here; it already copies the token's own
    MISC onto ``_cols[9]``, which is the same convention this now follows."""
    inner, last_of = set(), {}
    for m in mwt:
        inner.update(range(m["from"], m["to"]))   # every component EXCEPT the last — `to` is deliberately outside the range() stop
        last_of[m["to"]] = m
    for i, sa in enumerate(space_after):
        if sa or i >= len(tokens) - 1:            # a space here, or nothing follows to be glued to
            continue
        tid = i + 1                               # token ids are 1-based; space_after is 0-based
        if tid in inner:
            continue
        m = last_of.get(tid)
        if m is not None:
            cols = m.setdefault("_cols", ["_"] * 10)
            cols.extend(["_"] * (10 - len(cols)))   # a short _cols would put the flag in the wrong column
            cols[9] = _add_space_after_no(cols[9])
        else:
            tokens[i]["misc"] = _add_space_after_no(tokens[i]["misc"])


# Scripts that do NOT separate words with spaces. In these, the tokeniser's segmentation IS the word
# layer, so "several tokens with no space between them" — the whole of the heuristic below — describes
# an ordinary phrase, not one orthographic word, and must never be read as an MWT. Ranges, not a
# `unicodedata` script lookup: the stdlib exposes no script property, and these blocks are stable.
_SPACELESS_RANGES = (
    (0x2E80, 0x2FDF),      # CJK radicals + Kangxi radicals
    (0x3005, 0x303B),      # CJK iteration/repetition marks (々, 〆, 〳〴〵) — alphabetic, unlike the rest of 3000-303F
    (0x3040, 0x30FF),      # Hiragana + Katakana
    (0x3400, 0x4DBF),      # CJK Unified Ideographs Ext A
    (0x4E00, 0x9FFF),      # CJK Unified Ideographs
    (0xF900, 0xFAFF),      # CJK compatibility ideographs
    (0xFF66, 0xFF9F),      # halfwidth katakana
    (0x0E00, 0x0E7F),      # Thai
    (0x0E80, 0x0EFF),      # Lao
    (0x0F00, 0x0FFF),      # Tibetan (tsheg-delimited syllables, not space-delimited words)
    (0x1000, 0x109F),      # Myanmar
    (0x1780, 0x17FF),      # Khmer
    (0x20000, 0x323AF),    # CJK Ext B–I + compatibility supplement
)


def _spaceless_script(s: str) -> bool:
    """True when every LETTER of `s` belongs to a script written without word-separating spaces.

    Per-run rather than per-document, so a mixed sentence (``我用 Python 编程``) is judged one run at
    a time and the Latin run keeps its ordinary treatment. Only alphabetic characters are weighed —
    punctuation and combining marks say nothing about the script's word-separation convention — and
    a run with no letters at all (digits, symbols) is not claimed for the spaceless side."""
    letters = [ch for ch in s if ch.isalpha()]
    return bool(letters) and all(any(lo <= ord(ch) <= hi for lo, hi in _SPACELESS_RANGES)
                                 for ch in letters)


def _reconstruct_mwt(tokens: list[dict], space_after: list[bool]) -> list[dict]:
    """When the tokeniser splits one orthographic word into several tokens (e.g. Arabic
    clitics ``وذهب`` → و+ذهب, French ``du`` → de+le), rebuild the multi-word-token range.

    A "chunk" is a run of tokens up to the next trailing space; within a chunk, a maximal
    run of ≥2 non-punctuation tokens is an MWT (so ``المدرسة`` + ``.`` is NOT one — the ``.``
    is punctuation).  A run written in a SPACELESS script is never one, whatever its length —
    see `_spaceless_script`.  Component tokens keep their surface; the range form is their
    concatenation.

    This is the FALLBACK for tokenisers that publish nothing — see `_mwt_from_doc`. It is sound
    only because a spaCy `Tokenizer` cannot emit a token that isn't an exact substring of the
    input (`Doc.retokenize().split()` raises E117 otherwise), so concatenating the components
    reproduces the orthographic word. A *custom* tokeniser builds its Doc from a word list and
    is under no such constraint, which is exactly why it should publish its ranges instead.

    The spaceless guard used to be ``len(chunks) < 2`` — "only space-delimited text is
    considered". That tested a GLOBAL property of the input while the rule it protected was
    applied PER CHUNK, so one space anywhere disarmed it and every CJK chunk was then swallowed
    whole: ``我喜欢吃苹果。 他不喜欢。`` came back with the ranges 1-4 and 6-8, while the same text
    without the space between the sentences came back correctly empty. (`zh_sud_gsd_simp_trad`
    and `lzh_sud_kyoto` reach this function because they use stock spaCy tokenisers, which
    publish no ranges; the Stanza zh/ja pipelines have no `mwt` processor and never did.) The
    chunk-count test is gone rather than kept alongside the script test: with a real guard in
    place it only suppressed the genuine single-chunk case — an input that is one orthographic
    word, like a bare English ``don't`` → do+n't, which IS an MWT."""
    chunks = []
    start = 0
    for i, sa in enumerate(space_after):
        if sa or i == len(space_after) - 1:
            chunks.append((start, i))
            start = i + 1
    mwt = []
    for a, b in chunks:
        i = a
        while i <= b:
            if tokens[i]["upos"] == "PUNCT":
                i += 1
                continue
            j = i
            while j + 1 <= b and tokens[j + 1]["upos"] != "PUNCT":
                j += 1
            if j > i:   # ≥2 contiguous non-punct tokens with no internal space → a multi-word token
                form = "".join(tokens[k]["form"] for k in range(i, j + 1))
                if not _spaceless_script(form):   # …unless the script has no word spaces to begin with, where the run is a phrase
                    mwt.append({"from": i + 1, "to": j + 1, "form": form,
                                "_cols": [f"{i + 1}-{j + 1}", form, "_", "_", "_", "_", "_", "_", "_", "_"]})
            i = j + 1
    _mark_space_after(tokens, space_after, mwt)
    return mwt


# ── Stanza UD engine (→ SUD via grew) ────────────────────────────────────────
def _load_stanza(lang: str, package: str = "default", pretokenized: bool = False):
    key = f"{lang}#{package}" + ("#pretok" if pretokenized else "")
    if key in _STANZA_PIPES:
        return _STANZA_PIPES[key]
    try:
        import spacy_stanza
    except ImportError as exc:
        raise ParserUnavailable("spacy-stanza is not installed") from exc
    def _load(procs: str):
        # `tokenize_pretokenized` tells Stanza the sentence is ALREADY segmented — it then splits on
        # whitespace and nothing else, which is the promise `parse_pretokenized` needs. Cached under
        # its own key so a document does not share a pipeline between the two modes.
        return spacy_stanza.load_pipeline(
            lang, processors=procs,
            download_method="none", dir=STANZA_DIR, package=package, use_gpu=False,
            logging_level="ERROR", tokenize_pretokenized=pretokenized,
        )
    # Try the full pipeline, then progressively drop the OPTIONAL processors some languages lack:
    # `mwt` (no multi-word-token model) and `lemma` (an identity no-op with no model, e.g. Telugu).
    nlp = None
    last: Exception | None = None
    for procs in ("tokenize,mwt,pos,lemma,depparse",
                  "tokenize,pos,lemma,depparse",
                  "tokenize,pos,depparse"):
        try:
            nlp = _load(procs)
            break
        except Exception as exc:  # noqa: BLE001
            last = exc
    if nlp is None:
        # …AND THE REASON TRAVELS WITH IT. This loop swallows every exception from all three
        # processor sets, so "is not installed" was a GUESS at which of them fired — right for a
        # missing model directory and misleading for anything else (a torch/NumPy ABI mismatch, an
        # unreadable resources.json, a package name the treebank does not publish), all of which
        # reach the user as `parse()`'s `reason` and get read as fact. Name the likely cause, then
        # quote what actually failed; `str(exc)` alone can be empty, hence the class name.
        why = f"{type(last).__name__}: {last}".strip(": ") if last else "no error reported"
        raise ParserUnavailable(
            f"Stanza model {lang!r} could not be loaded (is it installed?) — {why}") from last
    pipe = nlp.tokenizer.snlp   # the underlying stanza.Pipeline (keeps MWT info)
    _STANZA_PIPES[key] = pipe
    return pipe


def _stanza_ud(text, lang: str, package: str, pretokenized: bool = False) -> tuple[list[dict], list[dict]]:
    """Run Stanza and extract UD tokens + MWT ranges from the stanza Document.

    Multiple detected sentences are flattened into one token table (the app treats
    each parse as a single sentence); heads are made positional across the whole text.

    ``pretokenized`` takes ``text`` as a list of sentences, each a list of word strings, and holds
    Stanza to that segmentation — see :func:`parse_pretokenized`."""
    pipe = _load_stanza(lang, package, pretokenized)
    sdoc = pipe(text)
    pos_of: dict[tuple[int, int], int] = {}
    gpos = 0
    for si, sent in enumerate(sdoc.sentences):
        for word in sent.words:
            gpos += 1
            pos_of[(si, word.id)] = gpos
    tokens: list[dict] = []
    mwt: list[dict] = []
    for si, sent in enumerate(sdoc.sentences):
        for token in sent.tokens:
            if len(token.words) > 1:   # a multi-word token, e.g. French "du" = de+le
                a = pos_of[(si, token.words[0].id)]
                b = pos_of[(si, token.words[-1].id)]
                misc = token.misc or "_"
                mwt.append({"from": a, "to": b, "form": token.text,
                            "_cols": [f"{a}-{b}", token.text, "_", "_", "_", "_",
                                      "_", "_", "_", misc]})
        for word in sent.words:
            head = "0" if not word.head else str(pos_of[(si, word.head)])
            deprel = "root" if head == "0" else (word.deprel or "")
            tokens.append(_tok(word.text, word.lemma or "", word.upos or "",
                               word.xpos or "", word.feats or "", head, deprel,
                               misc=word.misc or "_"))
    return tokens, mwt


def _parse_stanza_ud_to_sud(text: str, lang: str, package: str) -> tuple[list[dict], list[dict]]:
    tokens, mwt = _stanza_ud(text, lang, package)
    if not tokens:
        return whitespace_tokens(text), []
    ud_sent = {"sid": None, "text": text.strip(), "comments": [],
               "tokens": tokens, "mwt": [], "empties": []}
    try:
        sud_sent = convert.ud_to_sud([ud_sent])[0]
    except convert.ConversionUnavailable as exc:
        raise ParserUnavailable(
            "Stanza produces UD; converting to SUD needs grew (grewpy + opam "
            "backend). Install it, or use a SUD spaCy model.") from exc
    except convert.ConversionError as exc:
        raise ParserUnavailable(f"UD→SUD conversion failed: {exc}") from exc
    # SUD conversion relabels/reattaches but never adds or removes tokens, so the
    # positional MWT ranges are still valid — re-attach them.
    return sud_sent["tokens"], mwt


def _load_stanza_tok(lang: str, package: str = "default"):
    """A tokenise-ONLY Stanza pipeline (+ multi-word-token splitting where the model has it),
    cached apart from the full parsing pipeline. The fast first step for a Stanza model."""
    key = f"{lang}#{package}"
    if key in _STANZA_TOK_PIPES:
        return _STANZA_TOK_PIPES[key]
    try:
        import spacy_stanza
    except ImportError as exc:
        raise ParserUnavailable("spacy-stanza is not installed") from exc

    def _load(procs: str):
        return spacy_stanza.load_pipeline(
            lang, processors=procs, download_method="none",
            dir=STANZA_DIR, package=package, use_gpu=False, logging_level="ERROR")

    nlp = None
    last: Exception | None = None
    for procs in ("tokenize,mwt", "tokenize"):   # drop `mwt` for languages that lack the model
        try:
            nlp = _load(procs)
            break
        except Exception as exc:  # noqa: BLE001
            last = exc
    if nlp is None:   # the reason travels with it — see _load_stanza's own note on why
        why = f"{type(last).__name__}: {last}".strip(": ") if last else "no error reported"
        raise ParserUnavailable(
            f"Stanza model {lang!r} could not be loaded (is it installed?) — {why}") from last
    pipe = nlp.tokenizer.snlp
    _STANZA_TOK_PIPES[key] = pipe
    return pipe


def _stanza_tokenize(text: str, lang: str, package: str) -> tuple[list[dict], list[dict]]:
    """Tokenise (only) with Stanza → a flat, unparsed token table + MWT ranges. Roots the first
    token positionally; the follow-up parse (which re-runs Stanza's deterministic tokeniser over
    the same text) fills the real heads/relations."""
    pipe = _load_stanza_tok(lang, package)
    sdoc = pipe(text)
    pos_of: dict[tuple[int, int], int] = {}
    gpos = 0
    for si, sent in enumerate(sdoc.sentences):
        for word in sent.words:
            gpos += 1
            pos_of[(si, word.id)] = gpos
    toks: list[dict] = []
    mwt: list[dict] = []
    for si, sent in enumerate(sdoc.sentences):
        for token in sent.tokens:
            if len(token.words) > 1:
                a = pos_of[(si, token.words[0].id)]
                b = pos_of[(si, token.words[-1].id)]
                mwt.append({"from": a, "to": b, "form": token.text,
                            "_cols": [f"{a}-{b}", token.text, "_", "_", "_", "_",
                                      "_", "_", "_", token.misc or "_"]})
        for word in sent.words:
            j = pos_of[(si, word.id)]
            toks.append(_tok(word.text, head="0" if j == 1 else "1",
                             deprel="root" if j == 1 else "", misc=word.misc or "_"))
    if not toks:
        return whitespace_tokens(text), []
    return toks, mwt


# ── batch ────────────────────────────────────────────────────────────────────
def _parse_spacy_sud_many(texts: list[str], package: str, tb_lang=None,
                          arms: set | None = None) -> list[tuple]:
    """`_parse_spacy_sud` over a list, through ``nlp.pipe`` — which is spaCy's own batching and the
    reason this exists rather than a loop at the call site: the pipeline's components run over the
    whole batch at once instead of once per text."""
    nlp = _load_spacy(package)
    arms = set(ARMS) if arms is None else arms
    try:
        # `nlp.pipe(texts)` would build every Doc itself, leaving nowhere to stamp `tb_lang` before
        # the first component sees it — so the Docs are built here and piped as Docs, which
        # `Language.pipe` accepts and which keeps the batching this function exists for.
        from spacy.tokens import Doc
        if "tokenise" in arms:
            docs = [_tb(nlp.tokenizer(t), tb_lang) for t in texts]
        else:
            docs = [_tb(Doc(nlp.vocab, words=([f for f in t.strip().split() if f] or [t.strip()])),
                        tb_lang) for t in texts]
        off, arms = _pipe_plan(nlp, arms)
        docs = list(nlp.pipe(docs, disable=off))
    except Exception as exc:  # noqa: BLE001 — e.g. a raw-text tokeniser dependency isn't installed yet
        raise ParserUnavailable(str(exc)) from exc
    out = []
    for text, doc in zip(texts, docs):
        toks, mwt = _spacy_doc_to_sud(doc, arms)
        out.append((_apply_arms(toks, arms), mwt) if toks else (whitespace_tokens(text), []))
    return out


def _parse_stanza_many(texts: list[str], lang: str, package: str) -> list[tuple]:
    """`_parse_stanza_ud_to_sud` over a list, with **one** UD→SUD conversion for the whole batch.

    That single `convert.ud_to_sud` call is the win here and it is a large one: grew runs a worker
    POOL (`convert._POOL_WORKERS`), so a list of sentences is converted in parallel, where a call per
    sentence pays the dispatch serially and leaves every worker but one idle."""
    got = [_stanza_ud(t, lang, package) for t in texts]
    idx, sents = [], []
    for i, (tokens, _mwt) in enumerate(got):
        if tokens:
            idx.append(i)
            sents.append({"sid": None, "text": texts[i].strip(), "comments": [],
                          "tokens": tokens, "mwt": [], "empties": []})
    if sents:
        try:
            conv = convert.ud_to_sud(sents)
        except convert.ConversionUnavailable as exc:
            raise ParserUnavailable(
                "Stanza produces UD; converting to SUD needs grew (grewpy + opam "
                "backend). Install it, or use a SUD spaCy model.") from exc
        except convert.ConversionError as exc:
            raise ParserUnavailable(f"UD→SUD conversion failed: {exc}") from exc
        for k, i in enumerate(idx):
            got[i] = (conv[k]["tokens"], got[i][1])   # the conversion never adds or removes a token, so the positional MWT ranges still hold
    return [(tk, mwt) if tk else (whitespace_tokens(texts[i]), [])
            for i, (tk, mwt) in enumerate(got)]


def parse_many(texts, model_id: str = "", arms=None) -> list[dict]:
    """:func:`parse` over a list of texts, in ONE call and with the engine's own batching.

    The shape of each entry is exactly `parse`'s, so a caller can treat the two interchangeably. What
    it buys is not a different answer but a different cost: inserting a pasted passage used to make
    two awaited bridge round-trips PER SENTENCE (tokenize, then parse_text), each one re-entering the
    pipeline for a single string. Here the model is resolved once, spaCy sees the batch through
    `nlp.pipe`, and Stanza's UD→SUD conversion — much the most expensive part of that engine — runs as
    a single grew call across the whole list.

    A failure is reported PER ENTRY rather than raised, again matching `parse`: a paste that cannot be
    parsed still inserts, whitespace-tokenised, with the reason attached to every sentence."""
    texts = [str(t or "") for t in (texts or [])]
    if not texts:
        return []
    if not model_id:
        return [{"tokens": whitespace_tokens(t), "mwt": [], "parsed": False} for t in texts]
    arms = _effective_arms(model_id, arms)
    note = ""
    needs_upos = _needs_given_upos(model_id)
    if needs_upos:      # see `parse` just below — the same rule, and the same cascade
        arms.discard("upos")
        note = ("This model reads the word classes as INPUT and cannot tag for itself, so it is not "
                "asked to: with none given, its morphologiser and everything that reads it stay out "
                "of the run. Tag the tokens and the features and the tree follow.")
    try:
        engine, name, tb_lang = _resolve_model(model_id)
        if engine == "stanza":
            lang, _, package = name.partition("#")
            pairs = _parse_stanza_many(texts, lang, package or "default")
            return [{"tokens": _apply_arms(tk, arms), "mwt": m, "parsed": True,
                     "engine": "stanza", "model": name} for tk, m in pairs]
        package = name
        if engine != "sud":                      # legacy bare id → best-effort SUD package via the registry
            from . import models_registry
            package = models_registry.resolve_default_package(model_id)
            if not package:
                raise ParserUnavailable(f"unknown model {model_id!r}")
        pairs = _parse_spacy_sud_many(texts, package, tb_lang, arms)
        return [{"tokens": tk, "mwt": m, "parsed": True, "engine": "sud", "model": package,
                 **({"note": note} if note else {})} for tk, m in pairs]
    except ParserUnavailable as exc:
        return [{"tokens": whitespace_tokens(t), "mwt": [], "parsed": False, "reason": str(exc)}
                for t in texts]


# ── dispatch ─────────────────────────────────────────────────────────────────
def parse(text: str, model_id: str = "", arms=None) -> dict:
    if not model_id:
        return {"tokens": whitespace_tokens(text), "mwt": [], "parsed": False}
    arms = _effective_arms(model_id, arms)
    note = ""
    needs_upos = _needs_given_upos(model_id)
    if needs_upos:
        # ⚠ `upos` COMES OFF, AND THE CASCADE DOES THE REST. Striking `syntax` and `feats` by hand
        # here would have left the morphologiser RUNNING and its invented tags feeding the parser,
        # with both answers thrown away a line later — measured, on "The cat sat on the mat.": with
        # no UPOS given it returns DET ADJ DET ADV DET ADV DET. Dropping the arm the model cannot
        # supply lets `_pipe_plan` take the component out of the run altogether, and the model's own
        # dependency graph (`arm_deps`) then carries that through to everything that reads it.
        arms.discard("upos")
        note = ("This model reads the word classes as INPUT and cannot tag for itself, so it is not "
                "asked to: with none given, its morphologiser and everything that reads it stay out "
                "of the run. Tag the tokens and the features and the tree follow.")
    try:
        engine, name, tb_lang = _resolve_model(model_id)
        if engine == "sud":
            tokens, mwt = _parse_spacy_sud(text, name, tb_lang, arms)
            return {"tokens": tokens, "mwt": mwt, "parsed": True, "engine": "sud", "model": name,
                    **({"note": note} if note else {})}
        if engine == "stanza":
            lang, _, package = name.partition("#")
            tokens, mwt = _parse_stanza_ud_to_sud(text, lang, package or "default")
            return {"tokens": _apply_arms(tokens, arms), "mwt": mwt, "parsed": True,
                    "engine": "stanza", "model": name}
        # legacy bare id → best-effort SUD package via the registry
        from . import models_registry
        package = models_registry.resolve_default_package(model_id)
        if not package:
            raise ParserUnavailable(f"unknown model {model_id!r}")
        tokens, mwt = _parse_spacy_sud(text, package, tb_lang, arms)
        return {"tokens": tokens, "mwt": mwt, "parsed": True, "engine": "sud", "model": package,
                **({"note": note} if note else {})}
    except ParserUnavailable as exc:
        return {"tokens": whitespace_tokens(text), "mwt": [], "parsed": False,
                "reason": str(exc)}


def model_feats_inventory(model_id: str) -> dict:
    """``{FeatName: sorted[values...]}`` — every ``Feat=Val`` pair the model's own morphologizer can
    JOINTLY emit alongside *any* word class, read straight off ``morphologizer.labels`` (the same
    joint ``POS=X|Feat1=Val1|...`` label list :func:`_force_upos`/:func:`_upos_scores` already read —
    see either's own comment for what that string actually looks like).

    THIS IS THE "what does THIS model actually say", not the UD-wide reference table
    ``app/data/feats_inventory.json`` already ships (that one lists every value UD *defines*, for
    every language, independent of any model this app can load). A menu built from the UD-wide table
    alone can offer a value no installed model has ever produced (Ergative on an English model, say);
    this narrows it to what's actually reachable — the frontend intersects this with the UD table and
    with what's already IN the document, never uses it alone (a raw label inventory carries no
    human-friendly value descriptions, and mixing UNDOCUMENTED values into a menu would be its own
    kind of wrong).

    Empty dict, never raises, for: an unresolvable/unloadable model id, a Stanza model (a separate
    external process this app doesn't run label-introspection against — the frontend's own doc-mined
    fallback already covers that case), or a model whose pipeline carries no ``morphologizer`` at all.
    Cheap to call repeatedly: :func:`_load_spacy` caches the loaded pipeline, and reading a component's
    own ``.labels`` triggers no inference."""
    if not model_id:
        return {}
    engine, _, name = model_id.partition(":")
    if engine != "sud":
        return {}   # Stanza's label inventory isn't introspectable this way — see docstring
    if not name:
        return {}
    try:
        nlp = _load_spacy(name)
        morphologizer = nlp.get_pipe("morphologizer")
    except Exception:  # noqa: BLE001 — model not installed, or a pipeline shaped without this component
        return {}
    from spacy.morphology import Morphology
    out: dict[str, set] = {}
    try:
        for lab in morphologizer.labels:
            feats = Morphology.feats_to_dict(lab)
            feats.pop("POS", None)
            for k, v in feats.items():
                out.setdefault(k, set()).add(v)
    except Exception:  # noqa: BLE001 — a morphologizer shaped differently than expected
        return {}
    return {k: sorted(v) for k, v in out.items()}


def _force_upos(morphologizer, doc, upos, keep_feats=frozenset()) -> None:
    """Re-derive each token's FEATS **for the word class the reader chose**, in place.

    ⚠ THIS IS WHAT MAKES A RETAG DO ANYTHING AT ALL.  `parse_pretokenized` hands the pipeline the FORMS
    and nothing else, so the model re-analyses the same sentence it analysed before and returns the same
    answer — which means that after a reader retagged 行 from NOUN to VERB, the FEATS and the lemma that
    came back were still the NOUN's.  Nothing followed the edit; the re-parse was a no-op wearing the
    look of a refresh.

    The fix is not to overwrite the answer but to CONSTRAIN it.  spaCy's `Morphologizer` predicts UPOS
    and FEATS as ONE joint label (`POS=NOUN|Case=Nom|Number=Sing`), so the model already holds a score
    for every analysis it knows — including the verbal ones it ranked second.  Taking the best-scoring
    label whose `POS=` is the reader's therefore answers "what are this word's features AS a verb?" with
    the model's own evidence, rather than with a rule someone wrote here.  Where the model knows no label
    for that class the token is left exactly as the pipeline tagged it: an honest "this model has nothing
    to say", never an invented feature set.

    Run BETWEEN the morphologizer and the lemmatizer, so every later component sees the chosen class —
    which is the other half of the request.  ⚠️ It reaches a RULE-BASED lemmatiser (`Lemmatizer`, which
    keys on `token.pos_`) and not an `EditTreeLemmatizer`, whose model predicts an edit tree from the
    token vector alone and is POS-blind by construction; `en_sud_ewt_gum` ships the latter (a
    `trainable_lemmatizer` in the shipped wheel's own config — as the retired `en_sud_ewt` did before
    it, so the switch of bundled English model changes nothing here), so its lemma will not move on a
    retag however the class is set. That is a property of the released wheel, not something
    this function can route around — and it is the reason the constraint is applied to the FEATS here
    rather than the whole answer being re-asked."""
    if not upos:
        return
    try:
        labels = list(morphologizer.labels)
        scores = morphologizer.model.predict([doc])[0]
        from spacy.morphology import Morphology
        for i, want in enumerate(upos):
            if i >= len(doc) or not want or want == "_" or doc[i].pos_ == want:
                continue
            best, best_j = None, -1
            for j, lab in enumerate(labels):
                if f"POS={want}" not in lab.split("|"):
                    continue
                if best is None or scores[i][j] > best:
                    best, best_j = scores[i][j], j
            if best_j < 0:
                continue                       # the model knows no analysis of this class → leave it be
            feats = Morphology.feats_to_dict(labels[best_j])
            feats.pop("POS", None)
            # ⚠ UNLESS THE CALLER SUPPLIED THIS TOKEN'S FEATS. Re-deriving them for the chosen class
            # is this function's whole point where the MODEL owns the column — and is destructive
            # where the annotator does: they handed those values in as input, and replacing them with
            # the model's guess would undo, three components later, the thing the parse was given.
            if i not in keep_feats:
                doc[i].set_morph(feats)
            doc[i].pos_ = want
    except Exception:  # noqa: BLE001 — a model whose morphologizer is shaped differently keeps the plain answer
        pass


def parse_pretokenized(forms: list[str], model_id: str = "", upos: list[str] | None = None,
                       arms=None, given=None) -> dict:
    """Parse a sentence whose TOKENISATION IS ALREADY DECIDED — one token per entry of ``forms``.

    This is what "re-derive the model-derived fields for these tokens" needs, and it is not the same
    request as :func:`parse`. The caller (the frontend's `reparseTokenFields`, after a form or UPOS
    edit) has a token table it must keep: the heads, the relations and the annotation tiers hang off
    those exact tokens, so an answer with a different token count is not a worse answer, it is an
    unusable one.

    It used to be asked as `parse(" ".join(forms))`, and that quietly failed whenever the tokeniser
    disagreed with the join — which is routine in a SPACELESS SCRIPT, where the tokeniser is a
    segmenter and the spaces are not evidence it is obliged to respect. Editing 苹果 to 苹果汁 in
    ``我 喜欢 吃 苹果 。`` comes back as SIX tokens (苹果 + 汁), the count check fails, and the
    caller's `return false` meant the lemma, XPOS, FEATS and MISC of the edited token were simply
    never refreshed — silently, and with no way for the user to ask again.

    Bypassing the tokeniser removes the failure mode rather than detecting it: the alignment is 1-to-1
    by construction. spaCy supports this directly (build the ``Doc`` from a word list and run the
    pipeline components over it), and the SUD models are built for it — `sa_compound` exists
    specifically to supply its input feature "to a caller who hands the pipeline TOKENS rather than
    raw text". Stanza has ``tokenize_pretokenized``, which takes the same promise.

    ``upos`` — one word class per form, the READER's own tags — is what makes a retag mean something:
    the FEATS are re-derived for the class that was chosen and every component after the morphologizer
    sees it.  See `_force_upos`, which also states what a retag can and cannot move.

    Returns the same shape as :func:`parse` minus ``mwt``: the ranges belong to the caller's own
    table, and a re-parse that was forbidden to re-tokenise has nothing new to say about them."""
    forms = [str(f or "") for f in (forms or []) if str(f or "")]
    if not forms:
        return {"tokens": [], "parsed": False, "reason": "nothing to parse"}
    if not model_id:
        return {"tokens": whitespace_tokens(" ".join(forms)), "parsed": False}
    # TOKENISATION IS NOT AN ARM HERE and could not be: this function's whole contract is that the
    # tokenisation is already decided (see the docstring above), so there is nothing for the arm to
    # switch off. Every other arm applies exactly as it does to a full parse.
    arms = _effective_arms(model_id, arms) | {"tokenise"}
    note = ""
    needs_upos = _needs_given_upos(model_id)
    # The columns the ANNOTATOR is supplying — every arm they have switched off, plus `upos` whenever
    # it is passed as a retag constraint. See _GIVEN_SETTER for what that means and what it is worth.
    gset = _given_arms(given)
    has_upos = any(u and u != "_" for u in (upos or ()))
    # ⚠ A CALLER WHO SUPPLIES THE WORD CLASSES SATISFIES THE ARM. `_effective_arms` strikes `upos`
    # from a model that cannot tag for itself — right for a raw-text parse, wrong here, where the
    # classes are an ARGUMENT. Without this the cascade would read "no UPOS" and take the
    # morphologiser (and, for the generic parser, everything after it) out of a call whose whole
    # point is to re-derive the fields AROUND the tags just handed to it.
    if has_upos:
        arms.add("upos")
        gset.add("upos")
    elif needs_upos and "upos" not in gset:
        # …and here it is not a refusal but a request: this caller HAS the reader's tags (it is
        # re-deriving the fields around an edit they just made) and simply did not send them. Same
        # single `discard` as `parse`, and the same cascade behind it.
        arms.discard("upos")
        note = "Send the word classes: this model reads them as input and cannot tag for itself."
    try:
        engine, name, tb_lang = _resolve_model(model_id)
        if engine == "stanza":
            lang, _, package = name.partition("#")
            tokens, _mwt = _stanza_ud([forms], lang, package or "default", pretokenized=True)
            if len(tokens) != len(forms):
                raise ParserUnavailable("the model re-tokenised a pre-tokenised sentence")
            ud_sent = {"sid": None, "text": " ".join(forms), "comments": [],
                       "tokens": tokens, "mwt": [], "empties": []}
            try:
                tokens = convert.ud_to_sud([ud_sent])[0]["tokens"]
            except (convert.ConversionUnavailable, convert.ConversionError) as exc:
                raise ParserUnavailable(str(exc)) from exc
            return {"tokens": _apply_arms(tokens, arms, gset), "parsed": True,
                    "engine": "stanza", "model": name, **({"note": note} if note else {})}
        if engine != "sud":
            from . import models_registry
            name = models_registry.resolve_default_package(model_id) or ""
            if not name:
                raise ParserUnavailable(f"unknown model {model_id!r}")
        nlp = _load_spacy(name)
        doc = _given_doc(nlp, forms, tb_lang, upos, given)
        off, arms = _pipe_plan(nlp, arms, gset)
        keep = {i for i, v in enumerate((given or {}).get("feats") or ())
                if v and v != "_"} if "feats" in gset else frozenset()
        for _pname, proc in nlp.pipeline:
            if _pname in off:
                continue
            doc = proc(doc)
            if _pname == "morphologizer":
                _force_upos(proc, doc, upos, keep)   # …and everything downstream now reads the READER's word class

        tokens, _mwt = _spacy_doc_to_sud(doc, arms)
        tokens = _apply_arms(tokens, arms, gset)
        if len(tokens) != len(forms):
            # A component may still rebuild the Doc (clause_parser does); if one ever changes the
            # count the caller must be told, not handed a table it cannot align.
            raise ParserUnavailable("the pipeline changed the token count")
        for tok, f in zip(tokens, forms):
            tok["form"] = f          # the reader's spelling, quantities and all — this call re-derives FIELDS, never the forms
        # ⚠ AND A WORD CLASS THE CALLER SUPPLIED COMES BACK AS THEY SUPPLIED IT, on the same
        # principle as the form above: this call re-derives the fields AROUND the reader's edit, and
        # UPOS here is the edit. It matters because of `_apply_arms`: a model with no tagger of its
        # own has `upos` struck from its arms, which empties that column — correct for a raw-text
        # parse where nobody has said what the classes are, and destructive here, where the reader
        # has just typed them and `reparseTokenFields` is about to merge this answer back over their
        # tokens. The generic parser is exactly that model, so without this line the first custom
        # model would have silently wiped the tags its own analysis was conditioned on.
        # It ALSO used to be the only thing standing between the reader's tags and the generic
        # morphologiser's `overwrite = true`, which replaced them with its own guess mid-pipeline.
        # Upstream has since set `overwrite = false`, so that half is now belt to `sud_require_upos`'s
        # braces rather than the only guard — but a wheel that overwrites is a shape this function
        # still has to be correct for, and restoring the caller's own argument costs one loop.
        if upos:
            for tok, want in zip(tokens, upos):
                if want and want != "_":
                    tok["upos"] = want
        # …and every other column the caller handed in, for the same reason: this call re-derives the
        # fields AROUND what the annotator owns and may never hand back less of it than it was given.
        for arm in gset:
            col = _ARM_COLUMN.get(arm)
            if not col:
                continue
            for tok, want in zip(tokens, (given or {}).get(arm) or ()):
                if want and want != "_":
                    tok[col] = want
        return {"tokens": tokens, "parsed": True, "engine": "sud", "model": name,
                **({"note": note} if note else {})}
    except ParserUnavailable as exc:
        return {"tokens": [], "parsed": False, "reason": str(exc)}
    except Exception as exc:  # noqa: BLE001 — a pipeline that refuses pre-tokenised input must degrade
        return {"tokens": [], "parsed": False, "reason": str(exc)}


# ── THE RUNNERS-UP ──────────────────────────────────────────────────────────────────────────────
# Every component here scores a whole INVENTORY and the pipeline then keeps the argmax, so the
# ranking below the winner is computed and thrown away.  These functions hand it back instead.
#
# ⚠ THE DEPENDENCY PARSER IS TRANSITION-BASED, SO THERE IS NO "DISTRIBUTION OVER HEADS" TO READ OFF.
# A biaffine parser scores every (child, head) pair directly; spaCy's arc-eager one scores ACTIONS at
# a sequence of states, and a head distribution has to be recovered from them.  Two ways were measured
# before this one:
#   · `beam_parse` + `moves.get_beam_parses`, which is the documented route and is what it looks like
#     you should use.  It is nearly useless here: a greedily-trained model's action scores are so
#     peaked that a width-64 beam returns 64 state sequences collapsing onto 2-3 distinct TREES, and
#     across three ordinary sentences only 2 tokens got more than one candidate head at all.  Widening
#     it does not help (16/32/64 all gave the same 2), because the alternatives are not being pruned —
#     they are being assigned ~0 by the model.  Every other head then reads as exactly 0.0, which is
#     not "unlikely", it is "never enumerated", and the two must not look alike in the UI.
#   · scoring every (child, head) pair from a synthesised state, i.e. the biaffine question asked of a
#     transition parser.  That covers everything but answers a counterfactual — see `arc_label_scores`,
#     which is the one caller that genuinely wants it.
# What is used instead is the parser's OWN deliberation.  In arc-eager the only arc available at a
# state is between the stack top and the buffer front, so walking the greedy path and taking the
# softmax over valid actions at each step yields, for each token, the candidate heads it was actually
# weighed against and the mass the model gave each — which is exactly "the few most likely answers"
# rather than a ranking over an inventory it never considered.  Measured on the classic ambiguities:
# `with` in "I saw the man with the telescope" comes back saw .78 / man .22, and `that` in "the plan
# that the board had rejected" plan .54 / had .46, while an unambiguous determiner comes back 1.0 on
# its one head.  The walk is verified to reproduce the shipped parse exactly (`greedy` below is the
# same argmax the pipeline takes), so the winner in this table is always the tree on screen.
_SCORE_CACHE: dict = {}
_SCORE_CACHE_ORDER: list = []
_SCORE_CACHE_MAX = 48          # sentences; one entry is a few kB of small dicts


def _softmax(row, keep):
    """Softmax of `row` restricted to the indices in `keep`, as a plain list of floats."""
    import numpy as np
    v = np.asarray([row[i] for i in keep], dtype="float64")
    v = np.exp(v - v.max())
    s = v.sum()
    return (v / s).tolist() if s else [0.0] * len(keep)


def _arc_scores(parser, doc):
    """Walk the parser's greedy path, collecting the arcs it weighed at each state.

    Returns ``(heads, deprels)``, both 0-indexed by token:
      heads[i]   → {head_index_or_-1_for_root: p}
      deprels[i] → {head_index: {relation: p}}

    The masses a token collects are near-exclusive by construction — once it is attached it never
    reaches the stack/buffer boundary again — so they are used raw, with the SHORTFALL below 1
    credited to "no head", i.e. root.  That is what makes a root fall out of the walk rather than
    needing a rule: the sentence's actual root is offered arcs worth ~0.000 in total and so lands on
    root ≈ 1.0, while a token whose offers total 1.28 (the PP above, weighed twice) simply normalises."""
    import numpy as np
    names = [parser.moves.get_class_name(i) for i in range(parser.moves.n_moves)]
    step_model = parser.model.predict([doc])
    state = parser.moves.init_batch([doc])[0]
    n = len(doc)
    offers = [{} for _ in range(n)]
    labels = [{} for _ in range(n)]
    steps, cap = 0, 8 * n + 32          # arc-eager terminates in 2n; the cap is a guard, never a budget
    while not state.is_final() and steps < cap:
        steps += 1
        row = np.asarray(step_model.predict([state]))[0]
        valid = [i for i, nm in enumerate(names) if parser.moves.is_valid(state, nm)]
        if not valid:
            break
        probs = _softmax(row, valid)
        s0, b0 = state.S(0), state.B(0)
        if s0 >= 0 and b0 >= 0:
            for k, i in enumerate(valid):
                nm = names[i]
                if "-" not in nm or nm[0] not in "LR":
                    continue
                # L-x: head is the buffer front, child the stack top.  R-x: the other way round.
                child, head = (s0, b0) if nm[0] == "L" else (b0, s0)
                rel = nm[2:]
                offers[child][head] = offers[child].get(head, 0.0) + probs[k]
                labels[child].setdefault(head, {})
                labels[child][head][rel] = labels[child][head].get(rel, 0.0) + probs[k]
        parser.moves.transition(state, names[valid[int(np.argmax(probs))]])
    heads, deprels = [], []
    for i in range(n):
        tot = sum(offers[i].values())
        root = max(0.0, 1.0 - tot)
        denom = tot + root or 1.0
        h = {h_i: m / denom for h_i, m in offers[i].items() if m / denom >= 0.002}
        if root / denom >= 0.002:
            h[-1] = root / denom          # -1 → root; the caller renders it as head 0
        heads.append(h)
        # ⚠ ONLY FOR THE HEADS THAT SURVIVED THE PRUNE ABOVE.  Normalising a label set WITHIN its arc
        # hides how little the arc itself was worth: the root `saw` is offered arcs totalling 0.0004,
        # and dividing those by their own sum reported `parataxis` at 0.46 under `I` — a confident-
        # looking answer about an attachment the parser never entertained.  A head the reader picks
        # that is not in this table is a question for `arc_label_scores`, which is honest about being
        # a counterfactual, rather than for noise dressed up as deliberation.
        d = {}
        for h_i, ls in labels[i].items():
            if h_i not in h:
                continue
            t = sum(ls.values())
            if t:
                d[h_i] = {r: m / t for r, m in ls.items() if m / t >= 0.005}
        deprels.append(d)
    return heads, deprels


def _upos_scores(morphologizer, doc):
    """The morphologizer's own distribution, POOLED BY WORD CLASS.

    It predicts UPOS and FEATS as one joint label (`POS=NOUN|Case=Nom|Number=Sing` — the same fact
    `_force_upos` leans on), so the probability of a CLASS is the sum over every analysis carrying it.
    That pooling is also what item 4 needs for the menu's dot-suffixed subtypes: PRON.Dem and PRON.Int
    are two of PRON's labels, so a parent row's weight is the sum of its submenu's."""
    import numpy as np
    labels = list(morphologizer.labels)
    # ⚠ LOGITS, NOT PROBABILITIES — measured: a row sums to -147.3 and runs -16.4 … +21.0.  Reading
    # them as weights and normalising gives nonsense (it did: every class came back empty).  `_force_upos`
    # is unaffected because an argmax over a subset is scale-free, but a RANKING has to be softmaxed.
    scores = np.asarray(morphologizer.model.predict([doc])[0], dtype="float64")
    pos = []
    for lab in labels:                     # cache the POS= of each label once, not per token
        p = ""
        for part in lab.split("|"):
            if part.startswith("POS="):
                p = part[4:]
                break
        pos.append(p)
    out = []
    all_idx = list(range(len(labels)))
    for i in range(len(doc)):
        if i >= scores.shape[0]:
            out.append({})
            continue
        probs = _softmax(scores[i], all_idx)
        agg: dict = {}
        for j, p in enumerate(pos):
            if p:
                agg[p] = agg.get(p, 0.0) + probs[j]
        out.append({k: v for k, v in agg.items() if v >= 0.002})
    return out


def _score_doc(nlp, package, forms, upos=None, tb_lang=None):
    doc = _given_doc(nlp, forms, tb_lang, upos)
    heads: list = []
    deprels: list = []
    uposd: list = []
    for pname, proc in nlp.pipeline:
        if pname == "parser":
            heads, deprels = _arc_scores(proc, doc)
        elif pname == "morphologizer":
            uposd = _upos_scores(proc, doc)
        doc = proc(doc)
        if pname == "morphologizer":
            _force_upos(proc, doc, upos)
    return heads, deprels, uposd


def _sud_target(model_id: str) -> tuple:
    """``(package, tb_lang)`` behind a model id — ``("", None)`` for anything that is not a SUD spaCy
    model.  A CUSTOM model resolves to the shared generic package plus its own embedding row, so the
    two callers below (which read a component's raw scores) work on it unchanged."""
    if not model_id:
        return "", None
    try:
        engine, name, tb_lang = _resolve_model(model_id)
    except ParserUnavailable:
        return "", None
    if engine == "stanza":
        return "", None
    if engine != "sud":
        from . import models_registry
        return models_registry.resolve_default_package(model_id) or "", None
    return name, tb_lang


def _resolve_sud_package(model_id: str) -> str:
    """The spaCy package name behind a model id, or "" for anything that is not a SUD spaCy model."""
    return _sud_target(model_id)[0]


def analysis_scores(forms: list[str], model_id: str = "", upos: list[str] | None = None) -> dict:
    """What the pipeline ranked SECOND (and third) for one sentence's tokens.

    ``{"scored": True, "heads": [...], "deprels": [...], "upos": [...]}`` — one entry per form, with
    head keys as 1-based token ids and ``0`` for root, so the frontend can use them without an
    off-by-one of its own.

    ⚠ SUD spaCy models only.  A Stanza document is parsed in UD and then converted to SUD by grew,
    which REWRITES HEADS — so Stanza's own (genuinely biaffine, genuinely complete) head distribution
    describes a tree that is not the one on screen, and there is no honest way to carry it across the
    conversion.  ``scored: False`` is the answer there, and every caller degrades to its pre-existing
    behaviour rather than showing a weaker version of this."""
    forms = [str(f or "") for f in (forms or [])]
    if not forms or not any(forms):
        return {"scored": False, "reason": "nothing to score"}
    name, tb_lang = _sud_target(model_id)
    if not name:
        return {"scored": False, "reason": "the ranking below the winner is a SUD spaCy model's own"}
    # ⚠ A MODEL THAT READS THE WORD CLASSES CANNOT RANK A SENTENCE THAT HAS NONE. Its own guard
    # refuses the Doc, which would arrive here as a bare exception; and disabling the guard to get an
    # answer anyway would rank one sentence against a reading of it in which every token is
    # category-unknown. Say so instead — every caller of this already degrades to the plain editor
    # when the answer is `scored: False`.
    if _needs_given_upos(model_id) and not any(u and u != "_" for u in (upos or ())):
        return {"scored": False, "reason": "this model reads the word classes; tag the tokens first"}
    # ⚠ `tb_lang` IS PART OF THE CACHE KEY, not decoration. Every custom model shares ONE package
    # name, so keying on the package alone would hand the second custom model of a session the first
    # one's ranking for the same sentence — a different model's answer, silently, and the whole point
    # of a custom model is that its row makes it answer differently.
    key = (name, tb_lang, tuple(forms), tuple(upos or ()))
    hit = _SCORE_CACHE.get(key)
    if hit is not None:
        return hit
    try:
        nlp = _load_spacy(name)
        heads, deprels, uposd = _score_doc(nlp, name, forms, upos, tb_lang)
        if len(heads) != len(forms):
            return {"scored": False, "reason": "the pipeline changed the token count"}
        out = {
            "scored": True,
            # -1 is the walk's "no head"; the wire format is CoNLL-U's own 0, and every other id is 1-based.
            "heads": [{str(h + 1 if h >= 0 else 0): round(p, 4) for h, p in d.items()} for d in heads],
            "deprels": [{str(h + 1): {r: round(p, 4) for r, p in ls.items()}
                         for h, ls in d.items()} for d in deprels],
            "upos": [{k: round(v, 4) for k, v in d.items()} for d in uposd],
        }
    except Exception as exc:  # noqa: BLE001 — a pipeline shaped differently keeps the plain editor
        return {"scored": False, "reason": str(exc)}
    _SCORE_CACHE[key] = out
    _SCORE_CACHE_ORDER.append(key)
    while len(_SCORE_CACHE_ORDER) > _SCORE_CACHE_MAX:
        _SCORE_CACHE.pop(_SCORE_CACHE_ORDER.pop(0), None)
    return out


def _synth_state(parser, doc, i, j):
    """A state with the stack top at token ``i`` and the buffer front at ``j`` (``i < j``).

    Reached by driving the machine rather than parsing: push everything up to and including ``i``,
    then push-and-pop each token between them so it leaves the buffer without acquiring a head."""
    state = parser.moves.init_batch([doc])[0]
    while state.B(0) != -1 and state.B(0) < i:
        state.push()
    if state.B(0) == i:
        state.push()
    for _ in range(j - i - 1):
        if state.B(0) == -1:
            break
        state.push()
        state.pop()
    return state


def arc_label_scores(forms: list[str], model_id: str, child: int, head: int,
                     upos: list[str] | None = None) -> dict:
    """"If this token hung off THAT one, what would you call the edge?" — ``child``/``head`` 1-based.

    ⚠ THIS IS THE COUNTERFACTUAL QUESTION, and it is asked only where the honest one has no answer.
    `analysis_scores` reports the arcs the parser actually weighed, and a reader is free to drag a
    token onto a head it never entertained — at which point there is no recorded deliberation to
    consult, and the alternative to synthesising a state is to say nothing at all.  So the state is
    driven to put the two tokens at the stack/buffer boundary and the model is asked for its action
    scores there.  Its history features are not the ones a real parse would have accumulated, so this
    is the model's opinion of the arc rather than a probability from a parse; measured against the
    real state for a pair the walk DID weigh, it ranks the same two relations first and second and
    moves the split (saw→with: .785/.214 natural, .576/.416 synthesised).  Good enough to choose a
    label with, which is all any caller does with it — and never used to override the walk."""
    forms = [str(f or "") for f in (forms or [])]
    n = len(forms)
    if not (1 <= child <= n and 1 <= head <= n) or child == head:
        return {"scored": False}
    name, tb_lang = _sud_target(model_id)
    if not name:
        return {"scored": False}
    if _needs_given_upos(model_id) and not any(u and u != "_" for u in (upos or ())):
        return {"scored": False}      # see analysis_scores — the same refusal, for the same reason
    try:
        nlp = _load_spacy(name)
        import numpy as np
        doc = _given_doc(nlp, forms, tb_lang, upos)
        parser = None
        for pname, proc in nlp.pipeline:
            if pname == "parser":
                parser = proc
                break
            doc = proc(doc)
        if parser is None:
            return {"scored": False}
        c, h = child - 1, head - 1
        want = "L" if c < h else "R"       # child before head → a LEFT arc, and vice versa
        state = _synth_state(parser, doc, min(c, h), max(c, h))
        if state.S(0) != min(c, h) or state.B(0) != max(c, h):
            return {"scored": False}       # the machine would not go there; say nothing rather than guess
        names = [parser.moves.get_class_name(i) for i in range(parser.moves.n_moves)]
        row = np.asarray(parser.model.predict([doc]).predict([state]))[0]
        idx = [i for i, nm in enumerate(names) if nm[0] == want and "-" in nm]
        if not idx:
            return {"scored": False}
        probs = _softmax(row, idx)         # over the arc actions in the RIGHT DIRECTION only: the
        # question is "which relation", not "whether to attach" — the caller has already decided that.
        out = {names[i][2:]: round(p, 4) for i, p in zip(idx, probs) if p >= 0.005}
        return {"scored": True, "labels": out}
    except Exception as exc:  # noqa: BLE001
        return {"scored": False, "reason": str(exc)}


def tokenize(text: str, model_id: str = "", arms=None) -> dict:
    """The FAST first step of the tokenise → transliterate → parse sequence: tokenise ONLY (no
    tagging or parsing), so the tokens — and their transliterations — paint before the heavy
    parse runs. The follow-up parse is the ordinary :func:`parse` on the SAME text: every engine
    tokenises deterministically, so it reproduces exactly these tokens (and, unlike a Doc rebuilt
    from bare words, keeps the tokeniser's own norm/tag exceptions — e.g. English ``n't``). Same
    fallback contract as :func:`parse`; returns ``{"tokens","mwt","parsed":False, …}``."""
    if not model_id:
        return {"tokens": whitespace_tokens(text), "mwt": [], "parsed": False}
    # THE ONE ARM THIS CALL IS ABOUT. With tokenisation off — or with a model that ships no tokeniser
    # at all, which is every custom model — the preview is a whitespace split, exactly what the
    # follow-up parse will then work from, so the two never disagree about what the words are.
    if "tokenise" not in _arms(arms) or "tokenise" not in model_arms(model_id):
        return {"tokens": whitespace_tokens(text), "mwt": [], "parsed": False}
    try:
        engine, name, _tb_lang = _resolve_model(model_id)
        if engine == "sud":
            toks, _spaces, mwt = _spacy_tokenize(text, name)
            return {"tokens": toks, "mwt": mwt, "parsed": False, "engine": "sud", "model": name}
        if engine == "stanza":
            lang, _, package = name.partition("#")
            toks, mwt = _stanza_tokenize(text, lang, package or "default")
            return {"tokens": toks, "mwt": mwt, "parsed": False, "engine": "stanza", "model": name}
        from . import models_registry
        package = models_registry.resolve_default_package(model_id)
        if not package:
            raise ParserUnavailable(f"unknown model {model_id!r}")
        toks, _spaces, mwt = _spacy_tokenize(text, package)
        return {"tokens": toks, "mwt": mwt, "parsed": False, "engine": "sud", "model": package}
    except ParserUnavailable as exc:
        return {"tokens": whitespace_tokens(text), "mwt": [], "parsed": False, "reason": str(exc)}


# ── running-sentence alignment: which stretch of `# text` is each token? ──────────────────────
# The FRONTEND owns the primary answer and needs no backend at all: walking the surface units
# (each multi-word token once, its components never) and matching each form literally against
# `# text`, skipping only whitespace between them, reconstructs the spans exactly wherever the
# forms really are substrings of the text — which is the ordinary case, MWTs included.
#
# What lands HERE is only the case that walk cannot settle: `# text` is authoritative and may
# have been hand-edited, may spell a Typo=Yes word its corrected way, may have its tokens in a
# different order, or (Sanskrit) may carry external sandhi that no component form appears in.
# For those, the TOKENISER knows offsets the reconstruction cannot: it produced its units FROM
# this very text, so each carries a real character span. We align the FILE's units to the
# tokeniser's units — never substitute them, because the file's tokenisation is the annotation
# and the model's is only a second opinion about the same string.
def _tokenizer_spans(text: str, model_id: str) -> list[tuple[int, int, str]]:
    """The tokeniser's own SURFACE units over ``text`` as ``(start, end, form)``.

    "Surface" means the multi-word token itself where there is one (Stanza's ``Token`` vs its
    ``words``) — the same unit the caller's list is built from, so the two sequences are
    comparable. The third element is the tokeniser's FORM, not the substring: for a tokeniser that
    rewrites what it reads (Sanskrit's sandhi splitter) those differ, and it is the form that the
    caller's own forms are comparable with.

    Two sources of offsets, in order of authority: the tokeniser's PUBLISHED spans
    (``_published_spans``) and ``token.idx`` where the tokeniser left the text alone. Returns ``[]``
    (rather than raising) whenever neither yields an honest answer: no model, or a tokeniser whose
    ``doc.text`` differs from the input, which means it RECONSTRUCTED the text (a sandhi/clitic
    splitter building its Doc from a word list) and its ``token.idx`` no longer indexes ``text``."""
    engine, _, name = (model_id or "").partition(":")
    if not model_id:
        return []
    if engine == "stanza":
        lang, _, package = name.partition("#")
        pipe = _load_stanza_tok(lang, package or "default")
        sdoc = pipe(text)
        out = []
        for sent in sdoc.sentences:
            for token in sent.tokens:   # a Token IS the surface unit; its .words are the components
                a, b = token.start_char, token.end_char
                if a is None or b is None:
                    continue
                out.append((int(a), int(b), text[int(a):int(b)]))
        return out
    if engine != "sud":
        from . import models_registry
        name = models_registry.resolve_default_package(model_id) or ""
        if not name:
            return []
    nlp = _load_spacy(name)     # an uninstalled model is fatal; the caller surfaces it as `reason`
    doc = nlp.tokenizer(text)
    pub = _published_spans(doc, text)
    if pub is not None:
        return pub
    if doc.text != text:
        # The tokeniser RECONSTRUCTED the text and published nothing: no honest offsets exist, and a
        # guess here would be a silently wrong decoration. (Sanskrit used to be rescued here by
        # re-running the CSL transform from the text; `sa_sud_vedic_ufal_dcs` publishes `src_spans`,
        # so it never reaches this line, and the CSL notation it needed is gone from the app.)
        return []
    return [(t.idx, t.idx + len(t.text), t.text) for t in doc]


def _published_spans(doc, text: str) -> list[tuple[int, int, str]] | None:
    """The tokeniser's OWN offsets into the string it was handed, when it publishes them — else
    ``None`` (meaning "ask the next source"), never ``[]``.

    A tokeniser that rewrites what it reads still knows where each token came from, and the
    convention for saying so is the spaCy extensions ``doc._.src_text`` (the exact string it was
    handed) + ``doc._.src_spans`` (one half-open ``(start, end)`` per token, or ``None``);
    `sa_sud_vedic_ufal_csl` ≥ the re-released 0.1.0 registers them, and any future clitic/sandhi
    splitter gets the same treatment for free — the same shape as the ``doc.user_data["mwt_ranges"]``
    convention `_mwt_from_doc` honours.

    ``src_text`` is checked against OUR string and is not a formality: `# text` escapes its line
    breaks as the two characters ``\\n``, so feeding the escaped form instead of the real newlines
    the sentence object holds would glue ``\\n`` onto the next word and shift that token and every
    span after it. A span set computed over a different string is exactly the silent corruption this
    function exists to refuse, so a mismatch falls through rather than being trusted."""
    try:
        from spacy.tokens import Doc
        if not (Doc.has_extension("src_text") and Doc.has_extension("src_spans")):
            return None                      # no such tokeniser is loaded — the extensions are additive
        if doc._.src_text != text:
            return None
        spans = doc._.src_spans
        if not spans or len(spans) != len(doc):
            return None
        out = []
        for tok, sp in zip(doc, spans):
            if not sp:
                continue                     # a token the tokeniser could not place: a hole, not a guess
            a, b = int(sp[0]), int(sp[1])
            if 0 <= a < b <= len(text):
                out.append((a, b, tok.text))
        return out or None
    except Exception:  # noqa: BLE001 — an unexpected extension shape must fall through, not raise
        return None


def token_spans(text: str, forms: list[str], model_id: str = "",
                parts: list[list[str]] | None = None, lang: str = "") -> dict:
    """Character spans in ``text`` for each of ``forms`` (the file's surface units, in order).

    ``spans[i]`` is ``[start, end]`` or ``None`` where no honest span could be found — a hole,
    not a guess, so the caller decorates what aligned and leaves the rest alone.

    ONE stage here, behind the frontend's own literal-match stage: **THE TOKENISER'S OWN OFFSETS**,
    mirroring :func:`sentencize`'s. The two unit SEQUENCES are diffed (``difflib``) so every run they
    agree on maps 1-to-1 onto the tokeniser's real offsets, and each DIVERGENT run is then aligned
    CHARACTER-wise inside the window its neighbours pin down, by the same :func:`_align_map` that
    maps a model sentence boundary back onto the original text. A file unit the tokeniser has no
    counterpart for (a token that isn't in the text at all) simply keeps its ``None``.

    ``parts`` — unit *i*'s component forms — and ``lang`` are accepted and unused. Both fed the
    Sanskrit CSL stage that used to sit in front of this one: ``lang`` selected it and ``parts``
    verified its reversed-sandhi alignment against the file's own components.
    `sa_sud_vedic_ufal_dcs` publishes real ``src_spans`` and needs no such reconstruction, so the
    stage is gone. The parameters stay because the frontend computes them anyway and dropping them
    from the bridge signature would break an older frontend against a newer shell for nothing.

    ⚠ SPANS MAY OVERLAP BY A CHARACTER, and the caller must tolerate it rather than treat it as
    corruption. A sandhi-splitting tokeniser reports the truth about a vowel coalescence: in
    ``vartmāpunar-``, the ``ā`` is simultaneously the end of ``vartma`` and the start of ``a``, so
    the two spans share it. A tiling invariant would have to answer that with a hole on one of the
    two words, which is less true and less useful than the overlap."""
    forms = [str(f or "") for f in (forms or [])]
    if not text or not forms:
        return {"spans": [], "reason": "nothing to align"}
    try:
        units = _tokenizer_spans(text, model_id or "")
    except Exception as exc:  # noqa: BLE001 — an unavailable model must degrade, never raise at the bridge
        return {"spans": [], "reason": str(exc)}
    if not units:
        return {"spans": [], "reason": "no tokeniser offsets for this text"}
    tforms = [u[2] for u in units]
    spans: list[list[int] | None] = [None] * len(forms)
    sm = difflib.SequenceMatcher(None, forms, tforms, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                spans[i1 + k] = [units[j1 + k][0], units[j1 + k][1]]
            continue
        if i2 <= i1 or j2 <= j1:
            continue        # units on ONE side only (an inserted/deleted word) → no span to give
        lo, hi = units[j1][0], units[j2 - 1][1]     # the text window this divergent run occupies
        sub, recon = text[lo:hi], "".join(forms[i1:i2])
        f = _align_map(recon, sub)
        p = 0
        for k in range(i1, i2):
            a = f(p)
            p += len(forms[k])
            b = f(p)
            if b > a:
                spans[k] = [lo + a, lo + b]
    return {"spans": spans, "source": "tokenizer"}


# ── sentence segmentation (for the "Insert text" flow) ────────────────────────
# Sentence-final punctuation across scripts: Latin ., ?, !, the ellipsis …, and the
# Indic daṇḍa/double-daṇḍa ।॥ . Closing quotes/brackets may trail the terminator.
_SENT_ENDERS = ".?!…।॥"          # . ? ! … । ॥
_SENT_CLOSERS = "\"'”’)]}》」』›»"   # " ' ” ’ ) ] } 》 」 』 › »


def _sentencizer_nlp(lang: str = "", model_id: str = ""):
    """A loaded spaCy pipeline whose sentence segmentation we can reuse, or None.
    Only the model the caller actually selected (``sud:<pkg>``) is used, so we never
    segment one language's text with another language's model."""
    if model_id:
        engine, _, name = model_id.partition(":")
        # …and never the GENERIC wheel, whose own `_resolve_model` target this would otherwise reach
        # through a `custom:` id. It ships no language-specific tokeniser, so its boundaries are
        # spaCy's bare `xx` rules over segments it never learnt — not the MODEL's answer, and worth
        # neither the 8 s load nor the `tb_lang` refusal that would follow it. `sentencize` falls
        # through to `_rule_sentencize`, which is the app's answer with no model at all.
        if engine == "custom" or name == "xx_sud_generic":
            return None
        if engine == "sud" and name:
            try:
                return _load_spacy(name)
            except ParserUnavailable:
                return None
    return None


def _stanza_sentence_ends(text: str, lang: str, package: str) -> list[int]:
    """Sentence-end character offsets from a Stanza TOKENISE-only pipeline — offsets into ``text``
    ITSELF, since Stanza's tokeniser reports real ``start_char``/``end_char`` and never rewrites the
    string (unlike a sandhi-splitting spaCy tokeniser, which is why the spaCy path needs _align_map).

    Stanza's tokeniser IS its sentence splitter, so this is the segmentation the selected model would
    use on this text anyway; the tokenise-only pipeline is the same object the fast first parse step
    loads (`_load_stanza_tok`), so asking for it here costs nothing extra once it is warm. Raises
    ParserUnavailable when the model isn't installed — the caller falls back to the rule splitter."""
    pipe = _load_stanza_tok(lang, package)
    sdoc = pipe(text)
    return [s.tokens[-1].end_char for s in sdoc.sentences if getattr(s, "tokens", None)]


def _rule_sentencize(text: str) -> list[str]:
    """A script-aware rule-based splitter: each non-blank line is segmented on runs of
    sentence-final punctuation (Latin + Indic daṇḍa), keeping the terminator with its
    sentence; a line with no terminator is a single sentence."""
    out: list[str] = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = line.strip()
        if not line:
            continue
        last, i, n = 0, 0, len(line)
        while i < n:
            if line[i] in _SENT_ENDERS:
                j = i + 1
                while j < n and line[j] in _SENT_ENDERS:
                    j += 1
                while j < n and line[j] in _SENT_CLOSERS:
                    j += 1
                if j >= n or line[j].isspace():
                    seg = line[last:j].strip()
                    if seg:
                        out.append(seg)
                    last = i = j
                    continue
                i = j
            else:
                i += 1
        tail = line[last:].strip()
        if tail:
            out.append(tail)
    return out


def _align_map(src: str, dst: str):
    """Return a monotonic map f(pos_in_src) -> pos_in_dst via longest-match alignment, so a
    boundary found in the tokeniser's reconstructed text can be located in the ORIGINAL text
    even when the tokeniser inserted spaces or restored sandhi (Sanskrit) between the two."""
    blocks = difflib.SequenceMatcher(None, src, dst, autojunk=False).get_matching_blocks()

    def f(pos: int) -> int:
        prev = 0
        for i, j, size in blocks:
            if pos < i:            # pos falls in a gap before this matching block
                return prev
            if pos < i + size:     # pos is inside this matching block → exact offset
                return j + (pos - i)
            prev = j + size        # advance past this block
        return len(dst)

    return f


def _extend_over_ender(text: str, pos: int) -> int:
    """If sentence-final punctuation immediately follows ``pos`` (past any spaces), move ``pos``
    past it so the terminator ends the CURRENT sentence rather than beginning the next — some
    models set the boundary just before the daṇḍa/period.  Idempotent when it's already included."""
    n = len(text)
    j = pos
    while j < n and text[j].isspace():
        j += 1
    if j < n and text[j] in _SENT_ENDERS:
        while j < n and text[j] in _SENT_ENDERS:
            j += 1
        while j < n and text[j] in _SENT_CLOSERS:
            j += 1
        return j
    return pos


def sentencize(text: str, lang: str = "", model_id: str = "", arms=None) -> list[str]:
    """Split ``text`` into sentences.  Uses the selected model's own sentence segmentation when one
    is loaded (its handling of the various sentence-final marks is best), but ALWAYS returns slices
    of the ORIGINAL ``text`` — a sandhi/compound-splitting tokeniser (Sanskrit) reconstructs altered
    token text, so we keep the model's boundaries yet leave the sentence verbatim and let the parser
    do the tokenisation.  Falls back to :func:`_rule_sentencize`, which needs no model at all."""
    text = (text or "").strip()
    if not text:
        return []
    # Sentence splitting OFF means one sentence, not "split it some other way": the reader has said
    # the paragraph in front of them is the unit, and a rule splitter second-guessing that is the
    # very thing they switched off.
    if "sentence" not in _arms(arms):
        return [text]
    ends: list[int] = []
    to_orig = (lambda p: p)
    engine, _, name = (model_id or "").partition(":")
    if engine == "stanza" and name:
        # A Stanza model used to fall straight through to the rule splitter — its pipeline isn't a spaCy
        # nlp, so _sentencizer_nlp returned None for it — which left a Stanza-only language with no model
        # segmentation at all in the one flow (Insert text / parallel texts) whose whole job is splitting
        # sentences. Its offsets are already into `text`, hence no _align_map (see _stanza_sentence_ends).
        lcode, _, pkg = name.partition("#")
        try:
            ends = _stanza_sentence_ends(text, lcode, pkg or "default")
        except Exception:  # noqa: BLE001 — not installed / Stanza tier absent: rules below
            ends = []
    else:
        nlp = _sentencizer_nlp(lang, model_id)
        if nlp is not None:
            try:
                doc = nlp(text)
                ends = [s.end_char for s in doc.sents if s.text and s.text.strip()]
                # map each model boundary (an offset into the RECONSTRUCTED doc.text) back onto
                # the original text; identity when the tokeniser preserved the text (e.g. English)
                if ends and doc.text != text:
                    to_orig = _align_map(doc.text, text)
            except Exception:  # noqa: BLE001 — segmentation is best-effort; fall back to rules
                ends = []
    if ends:
        segs, prev = [], 0
        for e in ends:
            cut = _extend_over_ender(text, to_orig(e))   # keep the terminator with THIS sentence
            seg = text[prev:cut].strip()
            if seg:
                segs.append(seg)
            prev = cut
        tail = text[prev:].strip()   # anything past the last boundary
        if tail:
            segs.append(tail)
        if segs:
            return segs
    return _rule_sentencize(text)
