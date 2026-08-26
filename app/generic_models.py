"""Custom parser models: instances of the LANGUAGE-AGNOSTIC generic SUD pipeline.

One wheel, many languages.  ``xx_sud_generic`` is a morphologiser that predicts FEATS from UPOS
feeding a dependency parser that reads UPOS + decomposed FEATS + a **trainable 128-d per-language
embedding**, trained on 80 SUD 2.18 treebanks.  It supplies FEATS, heads and relations; the
annotator supplies the tokens and the UPOS.  A "custom model" here is not another wheel — it is one
ROW of that wheel's embedding table, fitted for a language of the reader's choosing, so a reader may
make as many as they like at a couple of kilobytes each.

⚠ **THE WHEEL IS FETCHED, NEVER BUNDLED, AND THAT IS A LICENCE RULE RATHER THAN A SIZE ONE.**  It is
**CC BY-NC-SA 4.0**: 24 of its 80 training treebanks are NonCommercial (276 891 of 880 919 training
tokens), so the union of the corpus licences carries a NonCommercial term.  ``make_portable.sh``
pip-installs the wheels it distributes straight into the app bundle, so bundling this one would
attach that term to the WHOLE bundle — which is precisely why the bundled English parser is the
CC BY-SA ``en_sud_ewt_gum`` and not something better-scoring.  It is fetched on demand onto the
user's own machine, exactly as the grew grammars, Morpheus and the vidyut kosha are.  See
``docs/notes/packaging.md`` and CLAUDE.md's "Don't vendor what isn't licensed to ship".

⚠ **AN UNSEEN LANGUAGE IS REFUSED, NOT SUBSTITUTED.**  ``sud.GenericEmbed.v2``'s ``LangSlotExtractor``
raises for a ``Doc._.tb_lang`` it has no slot for, deliberately — "a default row would silently give
it some training language's vector".  So every custom model must own a slot before it can parse, and
:func:`create` assigns one from the 32 spare rows the table was built with.

⚠ **AND AN UNFITTED SPARE ROW IS NOT NEUTRAL.**  Upstream measured it costing Georgian 4 LAS against
having no channel at all.  That is why :func:`create` will not make a model without a training file
unless the language is one of the 80 the table was FITTED for, in which case there is nothing to fit:
the built-in row already is that language's vector.  The three states a custom model can be in are
``basis`` below.

The fitting itself is the wheel's own ``adapt_lang_embed``, imported rather than re-derived: the
part that matters is the optimizer wrapper that freezes every parameter except the embedding table,
and re-writing that here would mean re-deriving a freeze upstream verified (0.000e+00 drift in any
frozen parameter, and no row but the target moves).  What this module does NOT reuse is that
module's ``main()``, which writes a whole 45 MB ``nlp.to_disk`` per adapted language — the fitted row
is 128 floats, and storing the row alone is what makes "as many as they like" honest.
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import unicodedata

from .paths import APP_DATA

GENERIC_PKG = "xx_sud_generic"
GENERIC_MODEL_ID = f"sud:{GENERIC_PKG}"
CUSTOM_DIR = os.path.join(APP_DATA, "custom_models")
_INDEX = os.path.join(CUSTOM_DIR, "index.json")

# ── the training budget, and the floor under it ──────────────────────────────────────────────────
# Upstream's own sweep: ten sentences (129-188 tokens) moved Thai +12.18 LAS, Georgian +6.62, Basque
# +1.05; 25/50/100 keep improving slowly and 400 is no better than 100 anywhere.  So TWENTY sentences
# to fit on is comfortably past the point the curve flattens out of its steep part, and TEN to score
# on is the same order as the samples those figures were themselves measured at.
#
# ⚠ THE SPLIT IS WHAT MAKES THE NUMBER IN THE MODEL LIST MEAN ANYTHING, AND IT IS THE ONLY THING THE
# FLOOR GATES.  A model fitted and then scored on the same sentences reports a training-set score,
# which for 128 free parameters over a few thousand tokens reads far too high — and it would sit in
# the same column as every other row's genuinely held-out UAS/LAS, where a reader compares them.
#
# ⚠️ SO A SMALL FILE IS FITTED, NOT REFUSED.  It used to be refused outright, which got the trade the
# wrong way round: ten sentences is upstream's own headline result (Thai +12.18 LAS, Georgian +6.62),
# so a file below the floor is worth a great deal to the MODEL and worth nothing to the SCORE.  Below
# `MIN_SCORE_SENTS` the row is fitted on everything and reports no measurement at all — the held-out
# average, with a caveat saying the fitting used the whole file (`basis` = "fitted").  What is never
# done is scoring a model on the sentences it was fitted on.
MIN_SCORE_SENTS = 30           # 20 to fit + 10 to score, the smallest split worth reporting
HELDOUT_FRACTION = 0.2         # …of anything larger, so a big file scores on a proportionate slice
MIN_HELDOUT_SENTS = 10
# Below this a file is not worth calling training data — upstream's smallest measured sample is ten
# sentences (129-188 tokens), and the sheet says so rather than this refusing anything above it.
FEW_SENTS = 10
FIT_EPOCHS = 30                # adapt_lang_embed's own default
FIT_LR = 0.01
FIT_SEED = 0

# ── the score reported when there is nothing local to measure ────────────────────────────────────
# Macro over the TWENTY genus-disjoint held-out languages of the generic parser's own evaluation
# (SUD-spaCy `eval_g2_base_s0.log`, gold sentence boundaries, gold UPOS, punctuation excluded, the
# 30-label target).  It is the honest figure for "this model on a language it has never seen", and it
# is NOT the figure the wheel's own meta.json publishes — that one (UAS 80.25 / LAS 74.12) is the
# IN-SAMPLE dev score over the 80 training languages, twenty points higher, and putting it in a column
# next to a monolingual parser's held-out score would flatter it by exactly the amount that column is
# for.  Reported with `basis` = "heldout" so every surface that shows it can say which it is.
HELDOUT_UAS = 62.85
HELDOUT_LAS = 54.24
HELDOUT_LANGS = 20

# ── the arms this pipeline HAS ───────────────────────────────────────────────────────────────────
# Not a policy choice: it is what the wheel ships, and upstream states why each absence is deliberate.
#   · no tokeniser   — "there is no tokeniser; that is your business"
#   · no UPOS tagger — tagging is LEXICAL and does not transfer: a multilingual tagger over all 80
#                      treebanks reaches 32-39 % on held-out languages, no better than a single
#                      English tagger, and romanisation cannot close a 55-point gap
#   · no lemmatiser  — measured inert: across six held-out languages and two architectures an
#                      edit-tree lemmatiser never deviated from copying the wordform by more than
#                      +0.31 points, so none is shipped
#   · no XPOS        — a language-specific tag set is by definition not language-agnostic
#   · no SUD MISC    — the `sud_*` components are per-language wheels' own, trained per treebank
#   · no sentence splitting — it follows the tokeniser: spaCy's bare `xx` rules over text this
#                      pipeline has no language-specific segmenter for is not the MODEL's answer, so
#                      the app's own rule splitter (`parse._rule_sentencize`) does the job instead
# The frontend greys the arms absent here rather than offering a switch that cannot do anything —
# and greyed does NOT mean "nothing happens": tokenisation falls to a whitespace split and sentence
# splitting to the rule splitter, exactly as they do with no model installed at all. What is absent
# is the MODEL's opinion, which is what an arm switches.
GENERIC_ARMS = frozenset({"feats", "syntax"})

_lock = threading.RLock()
_SLUG_RE = re.compile(r"[^a-z0-9]+")


# ── the store ────────────────────────────────────────────────────────────────────────────────────
def _load() -> dict:
    try:
        with open(_INDEX, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and isinstance(data.get("models"), list):
            return data
    except FileNotFoundError:
        pass
    except Exception as exc:  # noqa: BLE001 — a corrupt index must not take the model list down
        print(f"[custom] index unreadable ({exc}); starting empty", file=sys.stderr)
    return {"models": []}


def _save(data: dict) -> None:
    os.makedirs(CUSTOM_DIR, exist_ok=True)
    tmp = _INDEX + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1)
    os.replace(tmp, _INDEX)      # atomic: a half-written index would lose every custom model at once


def _slug(name: str, taken: set) -> str:
    base = _SLUG_RE.sub("-", unicodedata.normalize("NFKD", name or "").lower()).strip("-") or "model"
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base}-{n}", n + 1
    return slug


def slot_key(slug: str) -> str:
    """The ``Doc._.tb_lang`` value a custom model parses under.

    Namespaced with a ``custom:`` prefix so it can never collide with one of the 80 built-in
    language codes — two models for the same language (a different training file each, which is the
    whole point of being able to make several) must not fight over one slot, and a custom model must
    never overwrite a built-in row that other models are still reading."""
    return f"custom:{slug}"


def entries() -> list[dict]:
    """Every custom model, as registry rows (``id``/``engine``/``label``/``uas``/``las``/…)."""
    with _lock:
        models = list(_load().get("models") or [])
    out = []
    for m in models:
        out.append({
            "id": f"custom:{m['slug']}", "engine": "custom", "custom": True,
            "lang": m.get("lang") or "", "package": GENERIC_PKG,
            "label": m.get("name") or m.get("slug"),
            "slug": m["slug"], "basis": m.get("basis") or "heldout",
            "uas": m.get("uas"), "las": m.get("las"),
            "train_file": m.get("train_file") or "", "train_name": m.get("train_name") or "",
            "train_sents": m.get("fit_sents") or 0, "score_sents": m.get("score_sents") or 0,
            "created": m.get("created") or 0, "installed": True,
        })
        # …and what those figures were measured on, computed HERE rather than by each surface that
        # shows them: three of them do, and a caveat that drifts between them is worse than none.
        out[-1]["caveat"] = caveat(out[-1])
    out.sort(key=lambda e: (e["label"] or "").lower())
    return out


def get(slug: str) -> dict | None:
    with _lock:
        for m in _load().get("models") or []:
            if m.get("slug") == slug:
                return dict(m)
    return None


def tb_lang_for(model_id: str) -> str | None:
    """The ``Doc._.tb_lang`` a ``custom:<slug>`` id parses under, or None if it isn't one."""
    engine, _, slug = (model_id or "").partition(":")
    if engine != "custom" or not slug:
        return None
    m = get(slug)
    if m is None:
        return None
    # A model whose language is one of the 80 and that was never fitted parses under the BUILT-IN
    # code: there is no row of its own to read, and the built-in one already is that language.
    return m.get("slot") or slot_key(slug)


# ── the wheel ────────────────────────────────────────────────────────────────────────────────────
def installed() -> bool:
    """Whether the generic wheel is on this machine — probed WITHOUT importing it (find_spec costs
    nothing and can't execute a half-installed model's ``__init__``).

    ⚠ EXTRAS FIRST. `models_registry.download` installs a model wheel with `pip install --target
    EXTRAS_DIR`, deliberately (a read-only or relocated bundle cannot write its own site-packages), so
    a freshly-downloaded generic parser is invisible to `find_spec` until that directory is on
    `sys.path`. The app puts it there at startup, but this module is also reached from a bridge call
    in a process that has just done the install — where the answer was a confident, wrong "not
    installed" on a wheel sitting right there."""
    try:
        import importlib
        import importlib.util

        from . import extras
        extras.activate()
        importlib.invalidate_caches()
        return importlib.util.find_spec(GENERIC_PKG) is not None
    except Exception:  # noqa: BLE001 — a broken/partial install is "not installed", as far as this goes
        return False


def status() -> dict:
    """What the Add-custom-model sheet needs before it can offer anything."""
    have = installed()
    return {
        "installed": have, "model_id": GENERIC_MODEL_ID, "package": GENERIC_PKG,
        "licence": "CC BY-NC-SA 4.0",
        "min_sents": MIN_SCORE_SENTS,   # the SCORING floor, not an acceptance one — see MIN_SCORE_SENTS
        "few_sents": FEW_SENTS,
        "heldout": {"uas": HELDOUT_UAS, "las": HELDOUT_LAS, "langs": HELDOUT_LANGS},
        "fitted_langs": sorted(fitted_languages()) if have else [],
        "arms": sorted(GENERIC_ARMS),
        "count": len(entries()),
    }


def _nlp():
    from . import parse
    return parse._load_spacy(GENERIC_PKG)     # …which applies every stored row on the way out


def _nodes(nlp):
    """The slot tables and the embedding tables of a loaded generic pipeline.

    There are TWO of each, and that is load-bearing: ``package_generic_v2.sh`` inlines a COPY of the
    encoder into the morphologiser (``replace_listeners``) because two listeners in one pipeline both
    resolve to whichever tok2vec is present and silently read the wrong one.  So the morphologiser and
    the parser carry SEPARATE embedding tables, trained together but not identical, and a row has to be
    read from and written to both — ``adapt_lang_embed`` allows both node ids in its optimizer for
    exactly this reason.  ``model.walk()`` is deterministic for a given pipeline, so the order is
    stable and a stored row list can be zipped back on by index."""
    from xx_sud_generic import adapt_lang_embed as adapt
    slots = adapt.find_nodes(nlp, "extract_lang_slot")
    embeds = [n for n in adapt.find_nodes(nlp, "embed") if n.has_param("E")]
    return slots, embeds


def fitted_languages(nlp=None) -> set:
    """The language codes the shipped table already has a fitted row for (80 of them)."""
    try:
        slots, _ = _nodes(nlp or _nlp())
        return {k for k in dict(slots[0].attrs["ls_slots"]) if not str(k).startswith("custom:")}
    except Exception:  # noqa: BLE001 — not installed, or shaped differently than expected
        return set()


def apply_to(nlp) -> None:
    """Patch every stored custom row into a freshly-loaded generic pipeline, in place.

    Called from ``parse._load_spacy_locked`` so the cached ``nlp`` is complete the moment it exists,
    and again from :func:`create`/:func:`remove` against the ALREADY-CACHED object — re-loading it to
    pick up a new row would cost the reader an 8 s model load for a 128-float write.

    Never raises: a stored row that no longer fits the table (a wheel rebuilt with a different width,
    a hand-edited index) drops that one model rather than taking the generic parser down with it — and
    the model then refuses at parse time with the wheel's own "no embedding slot" message, which names
    the problem better than anything this function could say about it here."""
    try:
        slots, embeds = _nodes(nlp)
    except Exception:  # noqa: BLE001
        return
    if not slots or not embeds:
        return
    with _lock:
        models = list(_load().get("models") or [])
    add: dict = {}
    for m in models:
        row, vecs = m.get("row"), m.get("vectors")
        key = m.get("slot")
        if key is None or row is None or not str(key).startswith("custom:"):
            continue                       # a built-in-row model has nothing to write
        if not isinstance(vecs, list) or len(vecs) != len(embeds):
            continue
        try:
            for node, vec in zip(embeds, vecs):
                E = node.get_param("E")
                if int(row) >= int(E.shape[0]) or len(vec) != int(E.shape[1]):
                    raise ValueError("row/width mismatch")
                E[int(row)] = node.ops.asarray1f(vec)
                node.set_param("E", E)
            add[key] = int(row)
        except Exception:  # noqa: BLE001 — drop this one model, keep the pipeline
            continue
    for node in slots:
        d = {k: v for k, v in dict(node.attrs["ls_slots"]).items() if not str(k).startswith("custom:")}
        d.update(add)
        node.attrs["ls_slots"] = d


def _free_row(nlp) -> int | None:
    """A spare embedding row nobody has claimed — the table ships with 32 of them past the 80 fitted."""
    slots, embeds = _nodes(nlp)
    used = set(dict(slots[0].attrs["ls_slots"]).values())
    with _lock:
        for m in _load().get("models") or []:
            if m.get("row") is not None:
                used.add(int(m["row"]))
    n_rows = int(embeds[0].get_param("E").shape[0])
    for i in range(n_rows):
        if i not in used:
            return i
    return None


# ── reading the training file ────────────────────────────────────────────────────────────────────
def _read(path: str) -> list[list[list[str]]]:
    """The training file as a list of sentences, each a list of ten-column word rows.

    ``adapt_lang_embed.read_conllu``'s own reader, not :mod:`app.io_conllu`: it is the one the wheel
    was fitted with, it drops MWT ranges (``3-4``) and empty nodes (``3.1``) exactly as training did,
    and it ships INSIDE the wheel precisely so a caller need not reproduce those rules."""
    from xx_sud_generic import adapt_lang_embed as adapt
    return adapt.read_conllu(path)


def _norm_deprel(rel: str) -> str:
    """The relation a row is scored against, in the model's OWN label space.

    ``adapt_lang_embed.docs_from_conllu`` builds its training targets as
    ``r[7].split("@")[0].split("$")[0].split("/")[0]`` — the 30 coarsened SUD relations, with the deep
    (``@``) suffix, the ``$`` and the ``/`` alternatives cut off.  Scoring has to normalise the gold
    the SAME way or every deep-annotated token counts as an error the model was never asked to avoid;
    the sub-relation colon (``comp:obj``) is NOT stripped, because those ARE distinct labels it
    predicts."""
    return (rel or "").split("@")[0].split("$")[0].split("/")[0]


def _usable(rows: list[list[str]]) -> bool:
    """Whether a sentence can serve as supervision: every head resolves, and it has words."""
    ids = {r[0] for r in rows}
    return bool(rows) and all(r[6] == "0" or r[6] in ids for r in rows)


def _examples(nlp, sents, key):
    """Gold ``Example``s for the fitting loop, mirroring ``adapt_lang_embed.docs_from_conllu``'s
    PARSER arm (``predict_tags`` off): UPOS and FEATS are the parser's INPUTS, so they go on the
    PREDICTED doc as well as the reference — the reference alone would be fitting the row against a
    doc the parser never sees."""
    from spacy.tokens import Doc
    from spacy.training import Example
    out = []
    for rows in sents:
        idx = {r[0]: i for i, r in enumerate(rows)}
        words = [r[1] for r in rows]
        heads, deps = [], []
        for i, r in enumerate(rows):
            if r[6] == "0":
                heads.append(i)
                deps.append("root")
            else:
                heads.append(idx[r[6]])
                deps.append(_norm_deprel(r[7]))
        ref = Doc(nlp.vocab, words=words, heads=heads, deps=deps,
                  sent_starts=[True] + [False] * (len(words) - 1))
        pred = Doc(nlp.vocab, words=words)
        for tok, p, r in zip(ref, pred, rows):
            if r[3] != "_":
                tok.pos_ = p.pos_ = r[3]
            if r[5] != "_":
                tok.set_morph(r[5])
                p.set_morph(r[5])
        ref._.tb_lang = pred._.tb_lang = key
        out.append(Example(pred, ref))
    return out


def _fit(nlp, key: str, row: int, sents, progress=None) -> dict:
    """Fit ONE embedding row on ``sents``, with every other parameter frozen.

    The freeze is upstream's, imported rather than restated: ``OnlyTheseModels`` wraps the optimizer
    and zeroes the gradient of every node that is not an embedding table, and the drift check below is
    the same assertion ``adapt_lang_embed`` makes — if any frozen parameter moved, this is ordinary
    fine-tuning on the target language and not embedding adaptation, and the two are not the same
    claim.  Raising is right: a silently fine-tuned pipeline would corrupt the SHARED generic model
    every other custom model reads."""
    import copy
    import random

    from thinc.api import Adam

    from xx_sud_generic import adapt_lang_embed as adapt

    slots, embeds = _nodes(nlp)
    for node in slots:                                  # the row must exist before a Doc can carry it
        d = dict(node.attrs["ls_slots"])
        d[key] = int(row)
        node.attrs["ls_slots"] = d

    examples = _examples(nlp, sents, key)
    if not examples:
        raise ValueError("no usable sentences in the training file")

    allow = {n.id for n in embeds}
    frozen = {n.id: {p: copy.deepcopy(n.get_param(p)) for p in n.param_names if n.has_param(p)}
              for _pn, proc in nlp.pipeline if getattr(proc, "model", None) is not None
              for n in proc.model.walk() if n.id not in allow}
    sgd = adapt.OnlyTheseModels(Adam(FIT_LR), allow)
    rng = random.Random(FIT_SEED)
    for ep in range(FIT_EPOCHS):
        rng.shuffle(examples)
        losses: dict = {}
        for i in range(0, len(examples), 16):
            nlp.update(examples[i:i + 16], sgd=sgd, losses=losses)
        if progress:
            progress(10 + int(70 * (ep + 1) / FIT_EPOCHS), f"Fitting the language embedding… {ep + 1}/{FIT_EPOCHS}")

    drift = 0.0
    for _pn, proc in nlp.pipeline:
        if getattr(proc, "model", None) is None:
            continue
        for n in proc.model.walk():
            if n.id in allow or n.id not in frozen:
                continue
            for pname, ref in frozen[n.id].items():
                if n.has_param(pname):
                    drift = max(drift, float(abs(n.get_param(pname) - ref).max()))
    if drift > 1e-6:
        raise RuntimeError(f"frozen parameters moved by {drift:.3e} — that is fine-tuning, "
                           "not embedding adaptation; the row was not kept")
    return {"vectors": [[float(x) for x in n.get_param("E")[int(row)]] for n in embeds],
            "tokens": sum(len(e.reference) for e in examples)}


def _score(nlp, key: str, sents) -> dict:
    """UAS/LAS of the pipeline on held-out gold sentences.

    ⚠ **GOLD UPOS *AND* GOLD FEATS ARE GIVEN, BECAUSE THAT IS THE BASIS OF THE FIGURE THIS ONE SITS
    NEXT TO.**  It looks like the wrong regime — the morphologiser is what predicts FEATS, so handing
    them over seems to score the parser on an input it will not have at annotation time.  But
    ``generic_corpus.annotate`` is upstream's single statement of the input regime and
    ``eval_generic_v2.run`` calls it with both ("the arm's DECLARED inputs"), so every published
    number for this model — including the held-out macro a fileless custom model falls back to, in the
    SAME column of the same list — was measured this way.  Scoring on a different regime here would
    put two figures a reader compares directly on two different bases, which is a worse fault than the
    optimism of gold FEATS.

    ⚠️ AND THE GOLD FEATS NOW GENUINELY SURVIVE THE MORPHOLOGISER, where they used not to.  The wheel
    shipped with ``overwrite = true``, which had it rewrite both columns from its own prediction
    before the parser's tok2vec ever read them — so gold FEATS were an input feature of the
    morphologiser rather than anything the parser saw.  Upstream set ``overwrite = false`` (and added
    ``sud_require_upos`` to close the hole that left), so a FEATS value given here is now carried
    through to the parser unchanged.  That makes this measurement slightly more optimistic than the
    same call made against the older wheel, and exactly as optimistic as the published figure it is
    printed beside, which is the property that matters.

    Punctuation is excluded, matching that same basis: spaCy's dependency scorer excludes ``punct`` by
    default and so does the generic parser's own evaluation.  Gold rows whose head does not resolve
    are dropped by :func:`_usable` before they reach here."""
    from spacy.tokens import Doc
    ok_h = ok_l = total = 0
    for rows in sents:
        idx = {r[0]: i for i, r in enumerate(rows)}
        doc = Doc(nlp.vocab, words=[r[1] for r in rows])
        for tok, r in zip(doc, rows):
            if r[3] != "_":
                tok.pos_ = r[3]
            if r[5] != "_":
                tok.set_morph(r[5])
        doc._.tb_lang = key
        doc = nlp(doc)
        for i, (tok, r) in enumerate(zip(doc, rows)):
            gold_rel = _norm_deprel(r[7])
            if gold_rel == "punct":
                continue
            gold_head = i if r[6] == "0" else idx[r[6]]
            pred_head = tok.i if tok.dep_ in ("root", "ROOT") or tok.head.i == tok.i else tok.head.i
            pred_rel = "root" if tok.dep_ in ("root", "ROOT") or tok.head.i == tok.i else (tok.dep_ or "")
            total += 1
            if pred_head == gold_head:
                ok_h += 1
                if pred_rel == gold_rel:
                    ok_l += 1
    if not total:
        return {}
    return {"uas": round(100.0 * ok_h / total, 2), "las": round(100.0 * ok_l / total, 2),
            "tokens": total}


# ── what the figures in the model list actually mean ─────────────────────────────────────────────
# One place, because three surfaces show it (the Model Manager row, the in-page sheet's row, and the
# Add-custom-model sheet's preview) and a caveat that drifts between them is worse than none.
def caveat(entry: dict) -> str:
    basis = entry.get("basis") or "heldout"
    lang = entry.get("lang") or ""
    if basis == "file":
        n, name = entry.get("score_sents") or 0, entry.get("train_name") or "the training file"
        return (f"Measured on {n} sentence{'s' if n != 1 else ''} held out of {name} — "
                f"the embedding was fitted on the other {entry.get('train_sents') or 0}.")
    if basis == "fitted":
        n = entry.get("train_sents") or 0
        return (f"Fitted on all {n} sentence{'s' if n != 1 else ''} of "
                f"{entry.get('train_name') or 'the training file'} — too few to hold any back, so "
                f"there is nothing measured on your data to report. The figures shown are the "
                f"parser's held-out average over {HELDOUT_LANGS} unseen languages. "
                f"{MIN_SCORE_SENTS}+ sentences would be scored on a held-out slice.")
    if basis == "builtin":
        return (f"No training file. {lang or 'This language'} is one of the 80 the generic parser was "
                f"trained on, so it parses with that language's own fitted embedding — but the "
                f"figures shown are the parser's held-out average over {HELDOUT_LANGS} UNSEEN "
                f"languages, not a measurement on your data.")
    return (f"No training file, so the language embedding is an unfitted spare row — which upstream "
            f"measured costing 4 LAS against carrying no language channel at all. The figures shown "
            f"are the parser's held-out average over {HELDOUT_LANGS} unseen languages, not a "
            f"measurement on your data. Ten annotated sentences are enough to fit one.")


def _stamp(path: str) -> tuple:
    """``(mtime, size)`` of the training file, or ``(0, 0)``.

    ⚠ RECORDED SO AN EDIT KNOWS WHETHER TO RE-FIT. Comparing PATHS alone would make "I corrected my
    treebank and want the model to learn from it again" impossible to express: the sheet pre-fills the
    file it already has, re-picking it yields the identical path, and nothing would happen. Comparing
    the file's own stamp catches that, and equally leaves a pure rename instant — re-fitting a
    thirty-epoch adaptation because someone fixed a typo in the model's NAME is a minute of the
    reader's time spent on nothing."""
    try:
        st = os.stat(path)
        return int(st.st_mtime), int(st.st_size)
    except Exception:  # noqa: BLE001 — a file that has moved or gone; the caller decides what that means
        return 0, 0


def _split(sents):
    """``(fit, held)`` — see :data:`MIN_SCORE_SENTS` for why a small file holds nothing back."""
    if len(sents) < MIN_SCORE_SENTS:
        # Too few to split. FIT ON ALL OF THEM AND MEASURE NOTHING: the sentences are worth having and
        # the score is not, and holding a couple back would buy a figure too noisy to print while
        # costing the fit the very evidence it is short of.
        return sents, []
    n_out = max(MIN_HELDOUT_SENTS, round(len(sents) * HELDOUT_FRACTION))
    # A DETERMINISTIC, INTERLEAVED split rather than a random one or a tail slice: a CoNLL-U file is
    # usually in document order, so the last fifth of it is one text's worth of one genre, and taking
    # every k-th sentence keeps both halves representative of the whole file without needing a seed
    # the reader would then have to be told about.
    step = max(2, len(sents) // n_out)
    held = [s for i, s in enumerate(sents) if i % step == 0][:n_out]
    heldset = {id(s) for s in held}
    return [s for s in sents if id(s) not in heldset], held


def _fit_from_file(nlp, key: str, row: int, conllu_path: str, progress=None) -> dict:
    """Fit ``row`` on a training file and score what was held out — the body :func:`create` and
    :func:`update` share.  Returns the record fields, or ``{"error": …}``."""
    def note(pct, msg):
        if progress:
            progress(pct, msg)

    note(2, "Reading the training file…")
    try:
        sents = [s for s in _read(conllu_path) if _usable(s)]
    except Exception as exc:  # noqa: BLE001
        return {"error": f"could not read {os.path.basename(conllu_path)}: {exc}"}
    if not sents:
        return {"error": f"{os.path.basename(conllu_path)} has no usable sentences — every one of "
                         f"them is empty or has a head that does not resolve.",
                "too_small": True, "sentences": 0}
    fit, held = _split(sents)
    note(8, f"Fitting on {len(fit)} sentences…")
    try:
        got = _fit(nlp, key, row, fit, progress)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"fitting failed: {exc}"}
    sc: dict = {}
    if held:
        note(85, f"Scoring on {len(held)} held-out sentences…")
        try:
            sc = _score(nlp, key, held)
        except Exception as exc:  # noqa: BLE001
            return {"error": f"scoring failed: {exc}"}
    mtime, size = _stamp(conllu_path)
    return {"slot": key, "row": int(row), "vectors": got["vectors"],
            "basis": "file" if held else "fitted",
            "uas": sc.get("uas", HELDOUT_UAS), "las": sc.get("las", HELDOUT_LAS),
            "fit_sents": len(fit), "fit_tokens": got["tokens"],
            "score_sents": len(held), "score_tokens": sc.get("tokens") or 0,
            "train_file": conllu_path, "train_name": os.path.basename(conllu_path),
            "train_mtime": mtime, "train_size": size}


# ── create / remove ──────────────────────────────────────────────────────────────────────────────
def create(name: str, lang: str = "", conllu_path: str = "", progress=None) -> dict:
    """Make one custom model.  ``progress(pct|None, note)`` is called as it proceeds.

    ``lang`` is the ISO code the reader picked (or "" for a name that is not a language at all — the
    name menu autocompletes over ISO 639-3 but does not insist on it, because a treebank of one
    dialect, one register or one author is a perfectly good thing to fit a row for and has no code).
    ``conllu_path`` is optional, and any size is accepted; see :data:`MIN_SCORE_SENTS` for why a file
    below the floor is fitted but not SCORED, rather than being scored on its own training
    sentences."""
    def note(pct, msg):
        if progress:
            progress(pct, msg)

    name = (name or "").strip()
    if not name:
        return {"error": "a custom model needs a name"}
    if not installed():
        return {"error": "the generic parser is not installed", "needs_generic": True}

    note(0, "Loading the generic parser…")
    try:
        nlp = _nlp()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"the generic parser could not be loaded: {exc}"}

    lang = (lang or "").strip().lower()
    fitted = fitted_languages(nlp)
    rec: dict = {"name": name, "lang": lang, "created": int(time.time())}
    with _lock:
        data = _load()
        rec["slug"] = _slug(name, {m.get("slug") for m in data.get("models") or []})
    key = slot_key(rec["slug"])

    if conllu_path:
        row = _free_row(nlp)
        if row is None:
            return {"error": "the generic parser's embedding table has no spare rows left; "
                             "remove a custom model to free one"}
        got = _fit_from_file(nlp, key, row, conllu_path, progress)
        if got.get("error"):
            _unslot(nlp, key)
            return got
        rec.update(got)
    elif lang and lang in fitted:
        # Nothing to fit: this language already HAS a fitted row, and refitting it on nothing would
        # be strictly worse than using it. No row of its own, so `slot` is the built-in code.
        rec.update(slot=lang, row=None, vectors=None, basis="builtin",
                   uas=HELDOUT_UAS, las=HELDOUT_LAS)
    else:
        row = _free_row(nlp)
        if row is None:
            return {"error": "the generic parser's embedding table has no spare rows left; "
                             "remove a custom model to free one"}
        rec.update(slot=key, row=int(row), basis="unfitted", uas=HELDOUT_UAS, las=HELDOUT_LAS,
                   # An all-zero row IS what an unassigned spare row holds, so writing zeros changes
                   # nothing about the model's behaviour — it makes the row this model's own, so a
                   # later model cannot be handed the same one, and makes apply_to able to restore it.
                   vectors=[[0.0] * int(n.get_param("E").shape[1]) for n in _nodes(nlp)[1]])

    note(95, "Saving…")
    with _lock:
        data = _load()
        data.setdefault("models", []).append(rec)
        _save(data)
    apply_to(nlp)              # the live, cached pipeline gains the row now — not at the next reload
    note(100, "Ready")
    return {"ok": True, "id": f"custom:{rec['slug']}", "entry": [e for e in entries()
                                                                if e["slug"] == rec["slug"]][0]}


def update(slug: str, name=None, lang=None, conllu_path=None, progress=None) -> dict:
    """Edit one custom model in place: rename it, re-point its language, or re-fit it on a file.

    ⚠ **EVERY FIELD IS None-MEANS-UNCHANGED AND ""-MEANS-CLEARED**, and the difference is not
    pedantry: with `""` doing both jobs, `update(slug, name="x")` — a pure rename — read as "and the
    training file is gone and the language is nothing", zeroed the fitted row and relabelled the model
    `unfitted`. It threw away a minute of fitting to correct a typo, silently, and the caller had
    passed nothing that said so. The sheet sends all three fields every time and is unaffected either
    way; a caller that names one field is the case this protects.

    ⚠ **THE SLUG NEVER MOVES, ONLY THE NAME.** The slug is this model's IDENTITY — the `custom:<slug>`
    id the document window's model picker holds, the `custom:<slug>` key written into the pipeline's
    `ls_slots`, and the key its stored embedding row is found by. Re-deriving it from a corrected name
    would orphan every one of those at once: the reader's selected model would silently become "none",
    and a row would stay written in the table under a key nothing points at any more. A name is a
    label; renaming is not re-creating.

    ⚠ **AND A RENAME DOES NOT RE-FIT.** Thirty epochs is a minute of the reader's time, and spending
    it because someone fixed a typo would make the edit sheet something to avoid. The row is re-fitted
    only when the evidence it was fitted FROM has actually changed — a different file, or the same
    file with a different mtime or size (see :func:`_stamp`, which is what makes "I corrected my
    treebank, learn it again" expressible at all)."""
    def note(pct, msg):
        if progress:
            progress(pct, msg)

    slug = (slug or "").strip()
    old = get(slug)
    if old is None:
        return {"error": "no such custom model"}
    name = (old.get("name") if name is None else str(name).strip()) or old.get("name") or slug
    lang = (old.get("lang") or "") if lang is None else str(lang or "").strip().lower()
    keep_file = conllu_path is None
    conllu_path = (old.get("train_file") or "") if keep_file else str(conllu_path or "")
    if not installed():
        return {"error": "the generic parser is not installed", "needs_generic": True}
    note(0, "Loading the generic parser…")
    try:
        nlp = _nlp()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"the generic parser could not be loaded: {exc}"}

    key = slot_key(slug)
    rec = dict(old)
    rec["name"] = name
    rec["lang"] = lang
    fitted = fitted_languages(nlp)

    if conllu_path:
        # Re-fit only where the evidence moved. Same path, same stamp, and vectors already stored →
        # this edit is about the name or the language, and the embedding it produced still stands.
        # `keep_file` short-circuits it outright: a caller that never mentioned the file cannot have
        # meant to re-fit from it, and must not pay for one even if the file has changed underneath.
        same = keep_file or (conllu_path == (old.get("train_file") or "")
                             and _stamp(conllu_path) == (old.get("train_mtime") or 0,
                                                         old.get("train_size") or 0)
                             and old.get("vectors"))
        if same:
            rec["slot"], rec["row"] = key, old.get("row")
        else:
            # ITS OWN ROW, NOT A NEW ONE. The model already owns a slot; taking a fresh one on every
            # edit would leak a spare row per re-fit and run the table's 32 out on a reader who was
            # only correcting their training data. `adapt_lang_embed` refits an assigned slot by
            # design ("note: … already has slot …; refitting it").
            row = old.get("row")
            if row is None:
                row = _free_row(nlp)
                if row is None:
                    return {"error": "the generic parser's embedding table has no spare rows left; "
                                     "remove a custom model to free one"}
            got = _fit_from_file(nlp, key, int(row), conllu_path, progress)
            if got.get("error"):
                return got
            rec.update(got)
    elif lang and lang in fitted:
        # Back to the built-in row for this language: the model's own row is now unused, so it is
        # released rather than left claimed — the table has 32 of them and an edit should not hoard.
        rec.update(slot=lang, row=None, vectors=None, basis="builtin",
                   uas=HELDOUT_UAS, las=HELDOUT_LAS)
        for k in ("train_file", "train_name", "train_mtime", "train_size",
                  "fit_sents", "fit_tokens", "score_sents", "score_tokens"):
            rec.pop(k, None)
    else:
        row = old.get("row")
        if row is None:
            row = _free_row(nlp)
            if row is None:
                return {"error": "the generic parser's embedding table has no spare rows left; "
                                 "remove a custom model to free one"}
        rec.update(slot=key, row=int(row), basis="unfitted",
                   uas=HELDOUT_UAS, las=HELDOUT_LAS,
                   vectors=[[0.0] * int(n.get_param("E").shape[1]) for n in _nodes(nlp)[1]])
        for k in ("train_file", "train_name", "train_mtime", "train_size",
                  "fit_sents", "fit_tokens", "score_sents", "score_tokens"):
            rec.pop(k, None)

    note(95, "Saving…")
    with _lock:
        data = _load()
        data["models"] = [rec if m.get("slug") == slug else m for m in (data.get("models") or [])]
        _save(data)
    # …and the live pipeline, which may still carry the OLD row under this same key. apply_to clears
    # every `custom:` slot before rewriting, so a model that has just given its row up is not left
    # with a stale one in the table.
    _unslot(nlp, key)
    apply_to(nlp)
    note(100, "Ready")
    out = [e for e in entries() if e["slug"] == slug]
    return {"ok": True, "id": f"custom:{slug}", "entry": out[0] if out else None}


def _unslot(nlp, key: str) -> None:
    """Take a key back out of the live slot tables — the failure path of a fit that never got stored,
    so a half-made model can't leave a slot claimed by nothing."""
    try:
        for node in _nodes(nlp)[0]:
            d = dict(node.attrs["ls_slots"])
            d.pop(key, None)
            node.attrs["ls_slots"] = d
    except Exception:  # noqa: BLE001
        pass


def remove(model_id: str) -> dict:
    """Delete one custom model.  Nothing on disk but a few kB of JSON, and the shared wheel is
    untouched — it is other custom models' home too, and removing it is the Model Manager's job."""
    engine, _, slug = (model_id or "").partition(":")
    if engine != "custom" or not slug:
        return {"error": f"not a custom model: {model_id!r}"}
    with _lock:
        data = _load()
        before = len(data.get("models") or [])
        data["models"] = [m for m in (data.get("models") or []) if m.get("slug") != slug]
        if len(data["models"]) == before:
            return {"error": "no such custom model"}
        _save(data)
    try:
        from . import parse
        nlp = parse._SPACY_MODELS.get(GENERIC_PKG)
        if nlp is not None:
            _unslot(nlp, slot_key(slug))
            apply_to(nlp)
    except Exception:  # noqa: BLE001 — the store is what decides; the live pipeline is a cache
        pass
    return {"ok": True, "id": model_id}
