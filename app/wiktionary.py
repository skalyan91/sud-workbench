"""Wiktionary definition lookup, for the diagram's "Definitions of …" context-menu item
(morphemic-gloss pre-fill: a picked definition is prepended to the token's MISC MGloss).

Queries the MediaWiki REST API's definition endpoint (en.wiktionary.org/api/rest_v1/page/
definition/{word}) rather than scraping Wiktionary's HTML directly — that endpoint is what
Wiktionary's own apps use, so it tracks the site's current markup/skin. (The PyPI
``wiktionaryparser`` package scrapes the page and expects pre-2023 heading markup —
`<h3><span id="Noun">` — that Wiktionary no longer emits, so it silently returns nothing.)

One request returns EVERY language section on the page, keyed by that language's Wiktionary
code (mostly ISO 639-1/-3, matching the codes this app already carries as DOCLANG) — so a
lookup needs no language name mapping, just the code. Every call is wrapped so a failure
yields an empty list (never raises); results are cached per (word, lang), independent of the
UPOS filter (which is applied on read, not baked into the cached fetch)."""

from __future__ import annotations

import re
from urllib.parse import quote

_CACHE: dict[tuple[str, str], dict] = {}   # (word, lang) → {"candidates":[{"text","entry_upos","head_upos"}],"error"}
_CONDENSE_CACHE: dict[str, list[dict]] = {}
_API = "https://en.wiktionary.org/api/rest_v1/page/definition/{}"
_HTML_API = "https://en.wiktionary.org/api/rest_v1/page/html/{}"
_UA = "SUD-Workbench/1.0 (https://github.com/; contact via the app repository) requests"
_SUD_EN = "sud:en_sud_ewt"          # Wiktionary's definition PROSE is always English, regardless of the headword's own language
_KEEP_FAMS = {"subj", "comp", "mod", "udep", "conj"}   # deprel families kept when condensing a segment (see _condense_segment)
# …and the relations that START A CANDIDATE OF THEIR OWN rather than being kept in the head's (see
# _clause_top).  Coordination only, and only the two relations that really are coordination: SUD's
# other two conj subtypes are not lists of senses — `conj:appos` is apposition, a second designation
# of the SAME referent ("The month Āṣāḍha", "the number 'ten'"), and `conj:dicto` is the ORAL-LANGUAGE
# disfluency relation (grammars/SUD_to_UD.grs turns it into UD `reparandum`; the app's own
# DEPREL_INFO glosses it "disfluency"), i.e. a self-repair.  Cutting at either would halve one
# phrase into two fragments instead of separating two senses.
_CUT_RELS = {"conj", "conj:coord"}

# Wiktionary's own partOfSpeech label (lowercased) → the UD/SUD UPOS tag it corresponds to.
# Drives BOTH: (a) which whole entries even apply to a token of a given UPOS, and (b) which
# condensed subtrees survive (their own re-parsed head must still be that word class).
_WIKI_POS_TO_UPOS = {
    "noun": "NOUN", "proper noun": "PROPN", "pronoun": "PRON", "verb": "VERB",
    "root": "VERB",   # Sanskrit verbs are cited by their ROOT ("गम्" gam "go"), listed under a "Root" heading rather than "Verb" — see _sanskrit_root_glosses for why this entry alone isn't enough
    "auxiliary verb": "AUX", "adjective": "ADJ", "adverb": "ADV",
    "preposition": "ADP", "postposition": "ADP", "adposition": "ADP", "circumposition": "ADP",
    "conjunction": "CCONJ", "coordinating conjunction": "CCONJ", "subordinating conjunction": "SCONJ",
    "determiner": "DET", "article": "DET", "numeral": "NUM", "number": "NUM",
    "particle": "PART", "interjection": "INTJ", "symbol": "SYM",
    "punctuation mark": "PUNCT", "letter": "X", "prefix": "X", "suffix": "X",
    "combining form": "X", "interfix": "X",
}

# Wiktionary's single-letter noun-gender abbreviation (from its <span class="gender"><abbr>m</abbr></span>
# headword markup) → the UD FEATS Gender value. Combined/uncertain forms ("mf", "m-p", …) are deliberately left
# unmapped (None) rather than guessed. The Leipzig abbreviation mirrors this app's own FEATS_GLOSS table
# (Gender=Masc→M, Gender=Fem→F, Gender=Neut→N, Gender=Com→CG) — CG rather than plain C, since C-alone is already
# used elsewhere in this app's Leipzig set (Case=Com→COM would collide at the single letter).
_WIKI_GENDER_TO_UD = {"m": "Masc", "f": "Fem", "n": "Neut", "c": "Com"}
_UD_GENDER_TO_LEIPZIG = {"Masc": "M", "Fem": "F", "Neut": "N", "Com": "CG"}

# The Python twin of the frontend's GLOSS_ABBR_RE (web/js/core/prefs.js) at STRING START: a run of
# [A-Z0-9] bounded by punctuation or the edge. Such a run is rendered as small caps — it is read as a
# Leipzig glossing abbreviation — so lowercasing it both destroys the rendering and, worse, the sense:
# Apte's own "N. of a king" (= "name of") reaches this path in the thousands, and "n. of a king" is a
# different, wrong claim. Only the leading case needs a regex; see _decap for why nothing else can be hit.
_LEAD_ABBR_RE = re.compile(r"\A[A-Z0-9]+(?=[^\w\s]|\Z)")


def _decap(text: str, upos: str) -> str:
    """A sense as it should be WRITTEN into MGloss: sentence-initial capitalisation undone.
    Dictionaries capitalise the first word of a sense because it opens a printed line, not because
    the word is capitalised — Apte does it to every single sense ("Divine", "Sport", "Water") — and a
    gloss is not a sentence.

    Only the LEADING capital is lowered, never the whole string, because every other capital in a
    gloss is load-bearing: a proper name inside the definition of a common noun ("an epithet of
    Viṣṇu", "N. of Arjuna", "One of the eight elephants of the quarters"), and any Leipzig
    abbreviation run, which the frontend small-caps by GLOSS_ABBR_RE. Casefolding the string would
    take all of those with it; touching only position 0 cannot reach any of them.

    Three things are left alone even at position 0:
      * ``upos == "PROPN"`` — the token being glossed is a proper noun, so the capital is part of the
        word, not of the typography ("Delhi", "Śiva");
      * a leading Leipzig abbreviation (``_LEAD_ABBR_RE``) — "N. of a king" stays "N. of a king";
      * a first word carrying a second capital ("US Navy", "N.B."), which is an abbreviation the
        frontend does NOT small-cap (GLOSS_ABBR_RE needs punctuation on both sides) and which
        lowercasing would mangle into "uS Navy".
    Apte and Wiktionary go through this same function, so a picked Sanskrit sense and a picked
    English one are cased alike."""
    if not text or (upos or "").strip().upper() == "PROPN" or not text[:1].isupper():
        return text
    first = text.split(" ", 1)[0]
    if _LEAD_ABBR_RE.match(text) or any(ch.isupper() for ch in first[1:]):
        return text
    return text[0].lower() + text[1:]


def _pos_matches(entry_upos: str, head_upos: str, wanted: str) -> bool:
    """Whether a candidate applies to a token tagged ``wanted``, at BOTH levels Wiktionary offers:
    the dictionary entry's own part-of-speech heading, and — since a condensed subtree can end up
    headed by a different word class than the whole entry — that subtree's re-parsed head.
    A PROPN token also takes NOUN entries: Wiktionary heads a "Proper noun" section only where the
    word is EXCLUSIVELY one, so a name that is also a common noun (Rose, Baker, Sun) has its senses
    under "Noun", and a PROPN token would otherwise be told its own dictionary has nothing to say.
    Deliberately NOT symmetric — a NOUN token is not offered PROPN entries, which was not asked for
    and would put "the capital of England" under an ordinary common-noun lookup."""
    if not wanted:
        return True
    ok = {wanted, "NOUN"} if wanted == "PROPN" else {wanted}
    return entry_upos in ok and (not head_upos or head_upos in ok)


def available() -> bool:
    try:
        import requests  # noqa: F401
        from bs4 import BeautifulSoup  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


_INVISIBLE_RE = re.compile("[​‌‍﻿­]")   # zero-width space/joiners, BOM, soft hyphen — Unicode "format" (Cf) characters, not whitespace (Zs), so \s never catches them; Wiktionary's markup sometimes trails one after a definition (e.g. a wrap hint around a citation link), and left in place it survives every whitespace-collapse untouched and lands invisibly in the app's gloss text


def _clean(html: str) -> str:
    """Plain-text gloss from one API definition's HTML fragment. Strips a nested <ol> —
    Wiktionary's own sub-senses — since the API already flattens each of THOSE into its own
    top-level entry right after this one; keeping it here would duplicate that text."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html or "", "html.parser")
    for ol in soup.find_all("ol"):
        ol.decompose()
    text = _INVISIBLE_RE.sub("", soup.get_text(" ", strip=True))
    return re.sub(r"\s+", " ", text).strip()


def _famof(deprel: str) -> str:
    return re.split(r"[:@/]", deprel or "", maxsplit=1)[0]


def _is_infinitive_marker(tok: dict) -> bool:
    """The bare "to" that opens a headless Wiktionary verb gloss ("To move swiftly.").  This
    treebank makes it the clause's structural root (governing the verb as a comp:obj), so the
    general root-is-always-kept rule would otherwise keep it in every verb definition — it
    carries no gloss content of its own, so it's excluded by POS + form, not position:
    UPOS PART (the closed class "to"/possessive 's'/negation belong to) AND the surface form is
    literally "to" — narrow enough to leave a genuine oblique/prepositional "to" (UPOS ADP) alone."""
    return tok.get("upos") == "PART" and (tok.get("form") or "").strip().lower() == "to"


def _is_negative(tok: dict) -> bool:
    """A negated determiner/particle ("no", "not") — kept even though its deprel family is
    "det"/"mod" isn't in the general keep-list, because dropping it inverts the definition's
    meaning ("no reason" ≠ "reason")."""
    feats = tok.get("feats") or ""
    return "PronType=Neg" in feats or "Polarity=Neg" in feats


def _cuts(deprel: str) -> bool:
    """Whether this relation starts a candidate of its own — the full relation, not its family, so
    the three `conj` subtypes can be told apart (see :data:`_CUT_RELS`).  The deep feature (`@…`)
    and any mSUD morph suffix (`/m`) are stripped first: `conj:coord@…` is still a coordination."""
    return re.split(r"[@/]", deprel or "", maxsplit=1)[0] in _CUT_RELS


def _clause_top(i: int, heads: list[int], deprels: list[str]) -> int:
    """The token heading `i`'s own candidate: walk up the head chain to the clause root, stopping
    early at any token whose own relation cuts (:func:`_cuts`) — that token heads a candidate of its
    own, and everything under it belongs to that one. Two tokens share a candidate exactly when this
    returns the same index for both. It also earns its keep on a multi-rooted parse, where each root
    heads a candidate of its own.
    The `seen` guard is for a cyclic parse — a malformed-model quirk, not something a well-formed
    tree can produce, but an infinite loop here would hang the whole lookup."""
    seen = set()
    while heads[i] > 0 and i not in seen and not _cuts(deprels[i]):
        seen.add(i)
        i = heads[i] - 1
    return i


def _practical_head(top: int, heads: list[int], toks: list[dict]) -> int:
    """The token a candidate is really ABOUT. Normally its clause top, EXCEPT a headless infinitive
    ("To move swiftly"), where the top is the bare "to" — dropped from the output entirely (see
    :func:`_is_infinitive_marker`), so its comp:obj verb child is what the candidate is headed by,
    and what a modifier has to hang off to count as modifying the head."""
    if not _is_infinitive_marker(toks[top]):
        return top
    children = [i for i in range(len(toks)) if i != top and heads[i] - 1 == top]
    return children[0] if children else top


def _condense_segment(text: str) -> list[dict]:
    """SUD-parse one clause (already split at semicolons/commas — see :func:`_condense`) and prune
    it down to its head plus any subj/comp/mod/udep/conj member (or a negative det/particle),
    dropping determiners/coordinators/punctuation/etc.

    A **coordination starts a candidate of its own** — a `conj`/`conj:coord` dependent is its own
    clause top (:func:`_clause_top` stops climbing at it), because a definition that coordinates is
    listing senses: "'difference' or 'distinction'" is two glosses, not one. Only those two
    relations cut, not the whole `conj` family; :data:`_CUT_RELS` says why `conj:appos` and
    `conj:dicto` are left alone. (Measured over the 2,343 definition segments of the brihat_jataka
    sweep: `conj:coord` occurs 220 times and splits 196 segments, `conj:appos` 9 times — every one
    of them "The month Āṣāḍha"-shaped — and `conj:dicto` not at all.)
    A `flat` dependent is kept in place and does NOT start a candidate:
    it used to, on the grounds that flat is what the parser gives an asyndetic list of near-synonyms
    ("cat tom tomcat"), but that split was deliberately reversed — an asyndetic list is left as the
    one phrase it was written as. (With it went the `flat@name` exemption that existed solely to
    stop a multi-word personal name being torn in half.) The two cuts were removed together and only
    the coordination one has been asked back, so `flat` stays as it is.

    On top of that, a modifier phrase is deleted — subtree and all — unless it BOTH attaches
    directly to the candidate's head AND sits immediately beside it. The test, in the relations this
    parse actually produces (SUD, `en_sud_ewt`, families read by :func:`_famof` so
    `mod@relcl`/`mod:appos` count as `mod`): a token whose deprel family is exactly `mod` survives
    only if (a) its GOVERNOR is the candidate's head and (b) the position immediately before or
    immediately after that head falls inside its own subtree. Everything else is dropped together
    with what it governs.
      * (a) alone used to be the whole rule, and "directly modifies the head" still means one `mod`
        arc from the head, nothing more — a modifier of a modifier ("a particular class of EVIL
        demons"), or a modifier hanging off a complement, is not about the head.
      * (b) is the tightening: **immediately adjacent**, read in the definition's OWN word order and
        before any pruning, meaning the phrase occupies the token slot touching the head on one side
        or the other. Reading it off the span rather than off the phrase's nearest token is what
        keeps a long phrase that reaches the head ("the man WHO CAME LATE") and drops a short one
        that does not, and it survives a non-projective span. So of "a rectangular flat surface" the
        parser hangs both adjectives straight off "surface" and only "flat", the token against it,
        stays; "rectangular", two slots away, goes. A `mod` that attaches to the head from across
        the clause is exactly what this is for: "in this sense mostly used reflexively for all three
        persons" hangs "in …" and "for …" straight off "used", and both now go whole, leaving
        "mostly used reflexively" where the old rule left "in sense mostly used reflexively for
        persons". Measured over the 2,343 definition segments of the brihat_jataka sweep, 53 condense
        differently and the mean gloss runs 1.84 → 1.81 words.
    The head here is :func:`_practical_head`, not the raw clause top, so "swiftly" survives in "To
    move swiftly" where the top is the discarded "to"; a governor equal to EITHER counts, since the
    two are the same node read before and after "to" is discounted.
    Two consequences worth stating: the phrase goes whole, so nothing is left stranded (dropping
    just the `mod` token of "wood used IN building" would keep the orphaned "building", which is a
    `comp` and so otherwise unconditionally kept); and a `mod` subtree containing a negation is
    never dropped, for the same reason :func:`_is_negative` exists at all — losing it would invert
    the definition rather than shorten it. `subj`/`comp`/`conj`/`flat`/`udep` are untouched by this:
    they are arguments and members, not modifiers, and pruning them was never the point.

    Returns one ``{"text","upos"}`` per candidate (`upos` = that candidate's own head, what the
    dictionary part-of-speech should match), in surface order — empty if nothing survives pruning."""
    from . import parse
    res = parse.parse(text, _SUD_EN)
    if not res.get("parsed"):
        return [{"text": text, "upos": ""}]   # the English SUD model isn't installed → fall back to the whole clause, unpruned, POS unknown
    toks = res.get("tokens") or []
    n = len(toks)
    if not n:
        return []
    heads = [int(t.get("head") or 0) for t in toks]           # 1-based; 0 = this clause's own root
    deprels = [t.get("deprel", "") for t in toks]
    fams = [_famof(d) for d in deprels]
    roots = [i for i in range(n) if heads[i] == 0]
    tops = [_clause_top(i, heads, deprels) for i in range(n)]
    kids: list[list[int]] = [[] for _ in range(n)]
    for i in range(n):
        if heads[i] > 0 and heads[i] - 1 != i:
            kids[heads[i] - 1].append(i)

    def subtree(i: int) -> list[int]:
        out, stack, seen = [], [i], set()   # `seen` for the same cyclic-parse reason _clause_top guards against
        while stack:
            j = stack.pop()
            if j in seen:
                continue
            seen.add(j)
            out.append(j)
            stack.extend(kids[j])
        return out

    cut: set[int] = set()   # tokens inside a modifier phrase that doesn't directly-and-adjacently modify the head — see the docstring
    for i in range(n):
        if fams[i] != "mod" or i in roots:
            continue
        top = tops[i]
        head = _practical_head(top, heads, toks)
        span = set(subtree(i))
        if heads[i] - 1 in (top, head) and (head - 1 in span or head + 1 in span):
            continue                                          # one arc from the head AND touching it in surface order: keep
        if any(_is_negative(toks[j]) for j in span):
            continue                                          # dropping a negation would invert the sense, not shorten it
        cut.update(span)
    keep = [i for i in range(n)
            if (i in roots or fams[i] in _KEEP_FAMS or fams[i] == "flat"
                or (fams[i] == "det" and _is_negative(toks[i])))
            and i not in cut
            and not _is_infinitive_marker(toks[i])]   # a flat member is kept in its head's own candidate ("cat tom tomcat" stays whole) — it no longer starts one
    if not keep:
        return []
    groups: dict[int, list[int]] = {}   # clause root → its kept members; insertion order = surface order, since `keep` is ascending
    for i in keep:
        groups.setdefault(tops[i], []).append(i)
    out = []
    for top, members in groups.items():
        # head upos: the candidate's own top token — usually the real semantic head, EXCEPT a
        # headless infinitive ("to move"), where the top ("to") is excluded from the output and its
        # comp:obj verb child takes over as the practical head. A multi-rooted parse (a rare model
        # quirk on odd fragments) leaves each root heading its own component, which is right anyway.
        head_upos = toks[_practical_head(top, heads, toks)].get("upos") or ""
        out.append({"text": " ".join(toks[i]["form"] for i in members), "upos": head_upos})
    return out


def _strip_parentheticals(text: str) -> str:
    """Drop every parenthesised aside, OUTERMOST pair first — nesting and all. A plain
    ``\\([^()]*\\)`` regex can only match an INNERMOST pair, so on a nested aside ("(a course (or a
    distance))") it would eat the inner one and leave the outer brackets stranded around the rest.
    Each dropped span becomes a space (the caller re-collapses whitespace), so the words either side
    of it don't fuse. Unmatched brackets are left as literal text rather than swallowing everything
    after them: only pairs that actually close are dropped, which is why this scans instead of
    counting depth as it goes."""
    stack: list[int] = []
    spans: list[tuple[int, int]] = []
    for i, ch in enumerate(text):
        if ch == "(":
            stack.append(i)
        elif ch == ")" and stack:
            spans.append((stack.pop(), i))
    if not spans:
        return text
    drop = bytearray(len(text))
    for a, b in spans:   # inner spans are redundant once the enclosing one is marked, but marking them costs nothing — and it IS what handles an inner pair sitting under an opener that never closes
        for j in range(a, b + 1):
            drop[j] = 1
    return "".join(" " if drop[i] else ch for i, ch in enumerate(text))


def _condense(text: str) -> list[dict]:
    """Strip parentheticals, then split `text` into separate senses at semicolons AND commas
    (textual splits — a comma-separated list of near-synonyms, e.g. "cat, tom, tomcat", each
    becomes its own candidate), condensing each resulting clause via :func:`_condense_segment`
    (which prunes, and splits a clause further only where it coordinates — see :data:`_CUT_RELS`).
    Parentheticals are dropped BEFORE parsing, not pruned after — a bracketed aside ("(a course
    or a distance)") is prose noise around the definition, not a sense worth surfacing on its own."""
    cached = _CONDENSE_CACHE.get(text)
    if cached is not None:
        return cached
    stripped = re.sub(r"\s+", " ", _strip_parentheticals(text)).strip()
    out = []
    for seg in re.split(r"[;,]", stripped):
        seg = seg.strip()
        if not seg:
            continue
        out.extend(_condense_segment(seg))
    if not out:
        out = [{"text": text, "upos": ""}]
    _CONDENSE_CACHE[text] = out
    return out


def _search_form(word: str, lang: str) -> str:
    """The term to actually query Wiktionary with.  Sanskrit tokens in this app are STORED as
    IAST romanisation regardless of the sentence's own script (app.translit's "stored=iast"
    convention — see its Sanskrit orthography rendering), but Wiktionary indexes Sanskrit
    entries under their Devanagari headword, so an IAST lemma needs converting first."""
    if lang == "sa":
        from . import translit
        deva = translit.orthography(word, "sa", "Devanagari")
        if isinstance(deva, str) and deva:
            return deva
    return word


def _fetch_html(search_form: str):
    """The full rendered page (Parsoid HTML, via the /page/html/ REST endpoint), parsed — or
    ``None`` on any failure. Every heading (any level) renders as its own flat, sequential
    <section>, so a specific language/POS heading's own content is exactly bounded (starts at
    that heading, ends where the next heading's section begins). Used where the narrower
    /page/definition/ endpoint drops something it doesn't recognise (a "Root" POS heading;
    the headword line's gender marking — neither is in that endpoint's allowlisted fields)."""
    if not available():
        return None
    try:
        import requests
        resp = requests.get(_HTML_API.format(quote(search_form, safe="")), headers={"User-Agent": _UA}, timeout=8)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        from bs4 import BeautifulSoup
        return BeautifulSoup(resp.text, "html.parser")
    except Exception:  # noqa: BLE001 — offline, timeout, a schema change, …
        return None


def _sanskrit_root_glosses(search_form: str) -> list[str]:
    """Sanskrit verbs are cited by their ROOT on Wiktionary (e.g. गम् "gam" → "to go"), under a
    "Root" heading — but the /page/definition/ endpoint's part-of-speech allowlist doesn't include
    "Root": it silently drops that section (or, on a page whose ONLY Sanskrit section is Root,
    404s outright — confirmed live: गम् has a real, populated Sanskrit#Root section, but 404s from
    /page/definition/ since nothing else on the page qualifies)."""
    soup = _fetch_html(search_form)
    if soup is None:
        return []
    in_sanskrit = False
    for sec in soup.find_all("section"):
        h = sec.find(["h2", "h3", "h4", "h5", "h6"])
        if not h:
            continue
        text = h.get_text(strip=True)
        if h.name == "h2":
            in_sanskrit = (text == "Sanskrit")
            continue
        if not in_sanskrit or text != "Root":
            continue
        ol = sec.find("ol")
        if not ol:
            return []
        return [g for g in (re.sub(r"\s+", " ", li.get_text(" ", strip=True)).strip()
                            for li in ol.find_all("li", recursive=False)) if g]
    return []


def _noun_genders(search_form: str, language: str) -> list[str | None]:
    """Wiktionary's own gender abbreviation ("m"/"f"/"n"/…, or None if ungendered/unmarked) for
    each "Noun" heading under ``language``, IN DOCUMENT ORDER — one entry per Noun heading found
    (a word can have several, e.g. separate etymologies), aligned positionally with the Noun
    entries the /page/definition/ endpoint returns for that language (that endpoint's JSON has no
    anchor/heading id to match by, and no gender field at all — it's not in its allowlist — so
    this is a full separate HTML fetch+parse, only done when the word actually has a Noun sense).
    The gender sits in the headword line's own markup — `<span class="gender"><abbr>m</abbr>` —
    immediately after the headword; only the FIRST such abbr per Noun section is read (a second
    "or feminine" alternate-form link elsewhere in that line is a DIFFERENT word, not this one's
    gender)."""
    soup = _fetch_html(search_form)
    if soup is None:
        return []
    out: list[str | None] = []
    in_lang = False
    for sec in soup.find_all("section"):
        h = sec.find(["h2", "h3", "h4", "h5", "h6"])
        if not h:
            continue
        text = h.get_text(strip=True)
        if h.name == "h2":
            in_lang = (text == language)
            continue
        if not in_lang or text != "Noun":
            continue
        abbr = sec.find("span", class_="gender")
        out.append(abbr.get_text(strip=True).strip() if abbr else None)
    return out


def _fetch(word: str, lang: str) -> dict:
    """Every condensed candidate for (word, lang), UNFILTERED — cached per (word, lang) so looking
    the same word up under a different UPOS (two tokens sharing a lemma but tagged differently,
    e.g. "record" as NOUN vs VERB) re-filters cheaply instead of re-fetching/re-parsing."""
    key = (word.lower(), lang)
    cached = _CACHE.get(key)
    if cached is not None:
        return cached
    if not available():
        result = {"candidates": [], "error": "requests/beautifulsoup4 are not installed"}
        _CACHE[key] = result
        return result
    search_form = _search_form(word, lang)
    candidates = []
    error = None
    lang_heading = None   # the page's own heading text for this language (e.g. "Sanskrit", "French") — an exact, unambiguous anchor id, straight from the API's own "language" field
    try:
        import requests
        resp = requests.get(_API.format(quote(search_form, safe="")), headers={"User-Agent": _UA}, timeout=8)
        if resp.status_code != 404:
            resp.raise_for_status()
            data = resp.json()
            entries = data.get(lang, []) or []
            if entries:
                lang_heading = entries[0].get("language") or None
            genders: list[str | None] = []
            if lang_heading and any((e.get("partOfSpeech") or "").strip().lower() == "noun" for e in entries):
                genders = _noun_genders(search_form, lang_heading)   # one extra HTML fetch, only when the word actually has a Noun sense
            noun_i = 0
            for entry in entries:
                pos_name = (entry.get("partOfSpeech") or "").strip().lower()
                entry_upos = _WIKI_POS_TO_UPOS.get(pos_name, "")
                gender = None
                if pos_name == "noun":
                    gender = genders[noun_i] if noun_i < len(genders) else None
                    noun_i += 1
                for d in entry.get("definitions", []) or []:
                    text = _clean(d.get("definition", ""))
                    if text:
                        for sub in _condense(text):
                            candidates.append({"text": sub["text"], "entry_upos": entry_upos, "head_upos": sub["upos"], "gender": gender})
    except Exception as exc:  # noqa: BLE001 — offline, timeout, no such page, a schema change, …
        error = str(exc)
    if lang == "sa" and error is None:   # the "Root" heading never comes through the call above (see _sanskrit_root_glosses) — fetch it separately
        root_glosses = _sanskrit_root_glosses(search_form)
        if root_glosses:
            lang_heading = lang_heading or "Sanskrit"
        for gloss in root_glosses:
            for sub in _condense(gloss):
                candidates.append({"text": sub["text"], "entry_upos": "VERB", "head_upos": sub["upos"], "gender": None})
    if error is not None:
        return {"candidates": [], "error": error, "page_url": None}   # NOT cached — a transient failure shouldn't stick forever
    page_url = (f"https://en.wiktionary.org/wiki/{quote(search_form, safe='')}#{quote(lang_heading, safe='')}"
                if lang_heading else None)   # the language section's own anchor — unambiguous (one h2 per language per page), unlike a bare POS anchor which can be "Verb_2" on a multi-etymology page
    result = {"candidates": candidates, "error": None, "page_url": page_url}
    _CACHE[key] = result
    return result


def lookup(word: str, lang: str, upos: str = "") -> dict:
    """Definitions for ``word`` in ``lang`` (a Wiktionary/ISO language code, e.g. "en", "fr";
    case-insensitive, blank defaults to "en"), restricted to those matching ``upos`` (a UD/SUD
    UPOS tag, e.g. "NOUN"/"VERB" — blank ⇒ no restriction) at BOTH levels: the dictionary entry's
    own stated part of speech, and — since a condensed subtree can end up headed by a different
    word than the entry's whole headword — that subtree's own re-parsed head (:func:`_pos_matches`,
    where a PROPN token also takes NOUN entries).  Each surviving sense is decapitalised unless the
    token is a PROPN (:func:`_decap`).
    Returns ``{"definitions": [{"text","gender_ud","gender_abbr"}, …], "page_url": "…" or None}`` —
    `gender_ud`/`gender_abbr` are only present on NOUN candidates whose headword carries a
    recognised gender (a UD Gender value + this app's own Leipzig abbreviation for it, e.g.
    Masc/M — see _WIKI_GENDER_TO_UD); `page_url` links to the word's own Wiktionary page, anchored
    at its language section (not filtered by `upos`) — or ``{"definitions": [], "error": "…"}`` on
    failure (offline, no such entry, …)."""
    word = (word or "").strip()
    lang = (lang or "").strip().lower() or "en"
    wanted = (upos or "").strip().upper()
    if not word:
        return {"definitions": []}
    fetched = _fetch(word, lang)
    if fetched.get("error"):
        return {"definitions": [], "error": fetched["error"]}
    out = []
    seen: set[tuple[str, str]] = set()
    for c in fetched["candidates"]:
        if not _pos_matches(c["entry_upos"], c["head_upos"], wanted):
            continue
        d = {"text": _decap(c["text"], wanted)}   # …decapitalised HERE, where the sense is finalised for display/MGloss, not in the cached fetch: the cache is per (word, lang) and re-read under whichever UPOS the token carries, and PROPN is the one that keeps its capital
        gender_ud = _WIKI_GENDER_TO_UD.get((c.get("gender") or "").strip().lower())
        if gender_ud:
            d["gender_ud"] = gender_ud
            d["gender_abbr"] = _UD_GENDER_TO_LEIPZIG[gender_ud]
        # Deduplicate, keeping the FIRST occurrence — Wiktionary repeats a short synonym across
        # senses and across etymologies all the time, and condensing collapses more of them still
        # ("a domestic cat" and "the domestic cat" both prune to "domestic cat"). Keyed on the
        # gender too, since an identical gloss under a different gender is a genuinely different
        # pick: choosing it writes that Gender to FEATS, and the menu files it under its own heading.
        key = (" ".join(d["text"].split()).casefold(), gender_ud or "")
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return {"definitions": out, "page_url": fetched.get("page_url")}
