"""CoNLL-U read/write for SUD Workbench.

The document model that the web frontend renders is a plain list of *sentence
dicts*.  This module converts between a ``.conllu`` file and that JSON-friendly
shape, and back again.

Round-trip fidelity is a hard requirement (open → save with no edits must be
byte-stable), so parsing is done by hand: every token line keeps its ten raw
columns as strings and every comment line is preserved verbatim.  The `conllu`
library parses FEATS/DEPS/MISC into structures and can renormalise them, which
would defeat byte-stability, so it is intentionally *not* used for I/O here.

Normalisation policy (the only ways a save may differ from the input):
  * a token/MWT/empty-node line's columns are re-joined with a single TAB;
  * an empty grid cell is written as ``_`` (canonical CoNLL-U);
  * an edited ``sent_id``/``text`` updates (or appends) the matching comment;
  * a trailing newline is ensured at end of file.
Well-formed canonical CoNLL-U is unaffected by all of the above.
"""

from __future__ import annotations

from typing import Any

COLS = ["id", "form", "lemma", "upos", "xpos", "feats",
        "head", "deprel", "deps", "misc"]

# fields the frontend grid can edit, in column order
_EDIT = ["form", "lemma", "upos", "xpos", "feats", "head", "deprel", "deps", "misc"]

# Managed `# key = value` metadata comments (carried on the sentence like sent_id/text). Each round-trips
# through the matching sentence-dict field: None ⇒ pass through verbatim (byte-stable for docs that don't
# carry it); a non-empty string ⇒ write/update; "" ⇒ remove the comment.
#   translit_scheme — the STORED transliteration scheme, i.e. the one MISC Translit/LTranslit is written in.
#     This is the only display-scheme choice a DOCUMENT owns: the script a document is read in, and the
#     romanisation shown beneath it, are properties of the READER and live in the app's per-language
#     preferences, so no key here describes them. A key naming one, in a file written by an older build or
#     another tool, is simply not managed metadata — it stays in `comments` and round-trips verbatim, which is
#     what any unrecognised `# key = value` line does;
#   stored — the older spelling of translit_scheme, still read so those files keep loading;
#   url — a per-sentence source URL (item 14).
_META_KEYS = ("translit_scheme", "stored", "url")

# Document / paragraph boundaries (universaldependencies.org/format.html).  These deliberately do NOT join
# _META_KEYS, because they are not `key = value` lines at all: the bare form carries no value (`# newdoc`),
# and the id form spells its key in TWO words (`# newdoc id = wsj2012-01-05`), which the generic reader
# below would split into a key of "newdoc id".  Four states ride on the sentence dict:
#   None   the sentence says nothing about this marker → any such comment passes through VERBATIM, which is
#          what keeps an untouched document byte-stable (the same contract _META_KEYS uses for None);
#   True   present, no id;   a string   present with that id;   False   removed.
# A marker whose value is unchanged is re-emitted as the ORIGINAL LINE, never re-rendered — so a file that
# spells it `#newdoc` or pads it differently still round-trips byte-for-byte once the frontend has read it
# (which it always has, since parse() fills these in for every sentence).
_BOUNDARY_KEYS = ("newdoc", "newpar")


def _boundary_of(body: str):
    """(key, True | id) for a `newdoc`/`newpar` comment body, else None."""
    for key in _BOUNDARY_KEYS:
        if not body.startswith(key):
            continue
        rest = body[len(key):]
        if rest == "":
            return key, True
        if not rest[:1].isspace():
            continue          # `# newdocument = …` merely starts with the same letters
        rest = rest.strip()
        if rest == "":
            return key, True  # trailing whitespace only
        if rest.startswith("id"):
            after = rest[2:].lstrip()
            if after.startswith("="):
                return key, after[1:].strip()
        return None           # `# newdoc <something else>` — not a form this reader claims to understand
    return None


def _boundary_line(key: str, val: Any) -> str:
    return f"# {key}" if val is True else f"# {key} id = {val}"


def _blank(v: Any) -> str:
    """Map an empty/underscore cell to the canonical ``_``."""
    s = "" if v is None else str(v)
    return "_" if s.strip() in ("", "_") else s


def _parse_id(raw: str):
    """Return ('tok', int) | ('mwt', a, b) | ('empty', a, b) for a CoNLL-U id."""
    if "-" in raw:
        a, b = raw.split("-", 1)
        return ("mwt", int(a), int(b))
    if "." in raw:
        a, b = raw.split(".", 1)
        return ("empty", int(a), int(b))
    return ("tok", int(raw))


class ConllUParseError(ValueError):
    """A line is neither a `#` comment, a blank sentence-separator, nor a well-formed
    token/MWT/empty-node line — surfaced with the ORIGINAL file's line number and the raw text,
    instead of letting whatever `int()`/`.split()` call first choked on it leak out as a bare,
    contextless traceback line (api.py's open()/open_path() already do `str(exc)` straight to
    the user, so this exception's own message IS what they see)."""
    def __init__(self, lineno: int, raw: str, reason: str):
        self.lineno, self.raw = lineno, raw
        super().__init__(f"Line {lineno}: {reason}\n    {raw!r}")


def parse(text: str) -> list[dict]:
    """Parse CoNLL-U source text into a list of sentence dicts.

    Raises :class:`ConllUParseError` (a plain line number + the offending text, not a Python
    internals message) on a line that is neither a comment, a blank separator, nor a 10-column
    token/MWT/empty-node line — most often a stray raw newline that leaked into a `# text*`
    comment upstream (see _parse_block's own note) rather than damage inside this file's own
    writer, which sanitises exactly that case before it ever gets this far (see _update_comments).
    """
    sentences: list[dict] = []
    block_lines: list[tuple[int, str]] = []

    def flush():
        if not block_lines:
            return
        sentences.append(_parse_block(block_lines))
        block_lines.clear()

    for lineno, line in enumerate(text.split("\n"), start=1):
        # strip a single trailing CR (CRLF files) but keep the raw content
        if line.endswith("\r"):
            line = line[:-1]
        if line.strip() == "":
            flush()
        else:
            block_lines.append((lineno, line))
    flush()
    return sentences


def _parse_block(lines: list[tuple[int, str]]) -> dict:
    comments: list[str] = []
    tokens: list[dict] = []
    mwt: list[dict] = []
    empties: list[dict] = []
    translations: list[dict] = []
    sid = None
    stext = None
    meta_vals: dict[str, str] = {}
    bounds: dict[str, Any] = {}
    last_tok_id = 0

    for lineno, line in lines:
        if line.startswith("#"):
            comments.append(line)
            body = line[1:].strip()
            bm = _boundary_of(body)   # BEFORE the generic `key = value` reader: `# newdoc` carries no "=" at all
            if bm is not None:
                bounds[bm[0]] = bm[1]
                continue
            if "=" in body:
                key, val = body.split("=", 1)
                key, val = key.strip(), val.strip()
                if key == "sent_id":
                    sid = val
                elif key == "text":
                    stext = val
                # UD convention: fluent translations are `# text_LANG = …` comments,
                # LANG a lowercase ISO 639 code (see universaldependencies.org/format.html)
                elif key.startswith("text_") and len(key) > 5:
                    translations.append({"lang": key[5:], "text": val})
                # Scheme/URL metadata, carried as `# key = value` comments (the CoNLL-U-sanctioned way to
                # attach arbitrary metadata is a sentence comment; see universaldependencies.org/format.html).
                elif key in _META_KEYS:
                    meta_vals[key] = val
            continue
        cols = line.split("\t")
        # pad/truncate to exactly 10 columns, keeping raw strings
        cols = (cols + ["_"] * 10)[:10]
        try:
            kind = _parse_id(cols[0])
        except ValueError:
            if "\t" not in line:
                # the single most common real-world cause: a `# text*` comment upstream held a
                # literal (unescaped) newline instead of one written as "\n", so the writer that
                # produced this file split it into the comment PLUS this bare orphan line — see
                # ConllUParseError's own note, and _update_comments below for how this file's own
                # writer avoids ever doing that to a translation.
                reason = ("this line has no tab characters at all, so it's not a real token "
                          "row — it looks like a stray continuation of the comment just above it "
                          "(a raw line break where the source should have written \"\\n\")")
            else:
                reason = ("a token/MWT/empty-node line must start with an integer ID (\"7\"), "
                          "an MWT range (\"3-4\"), or an empty-node id (\"3.1\") — "
                          f"the first column here is {cols[0]!r}")
            raise ConllUParseError(lineno, line, reason) from None

        if kind[0] == "tok":
            tok: dict[str, Any] = {"id": kind[1]}
            for i, name in enumerate(COLS[1:], start=1):
                tok[name] = "" if cols[i] == "_" else cols[i]
            tok["head"] = cols[6]  # keep head as a string ("0" for root)
            tok["translit"] = ""
            tok["translitLemma"] = ""
            tokens.append(tok)
            last_tok_id = kind[1]
        elif kind[0] == "mwt":
            mwt.append({"from": kind[1], "to": kind[2],
                        "form": cols[1], "_cols": cols[:]})
        else:  # empty node
            empties.append({"after": last_tok_id, "id": cols[0], "_cols": cols[:]})

    result = {
        "sid": sid,
        "text": stext,
        "comments": comments,
        "translations": translations,
        "tokens": tokens,
        "mwt": mwt,
        "empties": empties,
    }
    for k in _META_KEYS:
        result[k] = meta_vals.get(k)
    for k in _BOUNDARY_KEYS:
        result[k] = bounds.get(k)   # None ⇒ this sentence starts no document/paragraph
    return result


def _token_line(idx: int, tok: dict) -> str:
    cols = [str(idx)]
    for name in _EDIT:
        cols.append(_blank(tok.get(name)))
    return "\t".join(cols)


def _oneline(s: str) -> str:
    """Collapse embedded newlines to spaces — every `# key = value` comment this writer emits is
    ONE physical line, and a raw "\\n" surviving into it splits the file into that (truncated)
    comment plus an orphan line the reader can't make sense of as anything (see ConllUParseError
    and its "no tab characters at all" diagnosis in parse(), which is exactly this shape). This is
    the one place that guarantee is enforced, so every caller below routes through it rather than
    trusting its own value is already newline-free — a value crossing this boundary is usually
    free-form text (a pasted or auto-generated translation, an edited `# text`) that had no reason
    to promise that on its own. No-op, and therefore byte-stable, for a value that never had one."""
    return " ".join(s.split("\n"))


def _update_comments(sent: dict) -> list[str]:
    """Return the sentence's comment lines, refreshing sent_id/text/translations if edited."""
    comments = list(sent.get("comments") or [])
    updates = {}
    if sent.get("sid") is not None:
        updates["sent_id"] = _oneline(str(sent["sid"]))
    if sent.get("text") is not None:
        # `# text` is a single physical comment line — collapse any display line breaks the UI preserved
        # (item 12) back to spaces so the file stays valid. No-op for newline-free text → byte-stable.
        updates["text"] = _oneline(str(sent["text"]))

    # Translations round-trip as `# text_LANG = …` comments. When the sentence dict
    # carries a `translations` list it is authoritative: existing `# text_*` lines are
    # updated in place, dropped ones are removed, and new languages are appended. When
    # `translations` is absent (None) any `# text_*` comments pass through verbatim, so
    # an untouched document stays byte-stable.
    translations = sent.get("translations")
    manage_trans = translations is not None
    trans_map: dict[str, str] = {}
    trans_order: list[str] = []
    if manage_trans:
        for t in translations or []:
            lang = str(t.get("lang", "")).strip()
            if not lang:
                continue
            key = "text_" + lang
            if key not in trans_map:
                trans_order.append(key)
            # _oneline: a machine-translated/auto-generated string is exactly the kind of value
            # most likely to arrive carrying a real "\n" instead of the escaped "\\n" CoNLL-U
            # needs — this is the corruption this whole fix exists for; see _oneline's own note.
            trans_map[key] = _oneline(str(t.get("text", "")))

    # Document-level scheme metadata (`# translit_scheme = …`). A field that is
    # None passes through verbatim (byte-stable for docs that don't carry it); a non-empty string is
    # written/updated; an empty string removes the comment. Only sentences that actually carry the
    # field (typically the first) touch these lines.
    meta: dict[str, str] = {}
    for key in _META_KEYS:
        v = sent.get(key)
        if v is not None:
            meta[key] = _oneline(str(v))

    # Document/paragraph boundaries. Absent (None) ⇒ not managed at all, so the comment passes through
    # verbatim; anything else (True / an id / False) ⇒ this sentence dict is authoritative about the marker.
    bounds: dict[str, Any] = {}
    for key in _BOUNDARY_KEYS:
        v = sent.get(key)
        if v is not None:
            bounds[key] = v

    seen = set()
    seen_trans = set()
    seen_meta = set()
    seen_bound = set()
    out = []
    for line in comments:
        body = line[1:].strip() if line.startswith("#") else line
        bm = _boundary_of(body)   # first, for the same reason as in _parse_block: the bare form has no "="
        if bm is not None and bm[0] in bounds:
            key, want = bm[0], bounds[bm[0]]
            if want is not False:
                # re-emit the ORIGINAL line where the value is unchanged, so a differently-spelled but
                # equivalent marker (`#newpar`, extra padding) survives a save untouched
                out.append(line if bm[1] == want else _boundary_line(key, want))
            # else: cleared → drop the line
            seen_bound.add(key)
            continue
        if "=" in body:
            key = body.split("=", 1)[0].strip()
            if key in updates:
                out.append(f"# {key} = {updates[key]}")
                seen.add(key)
                continue
            if key in meta:
                if meta[key] != "":
                    out.append(f"# {key} = {meta[key]}")
                # else: cleared → drop the line
                seen_meta.add(key)
                continue
            if manage_trans and key.startswith("text_") and len(key) > 5:
                if key in trans_map:
                    out.append(f"# {key} = {trans_map[key]}")
                    seen_trans.add(key)
                # else: this translation was removed → drop the line
                continue
        out.append(line)
    # prepend any updated keys that had no existing comment (sent_id first, then text)
    for key in ("sent_id", "text"):
        if key in updates and key not in seen:
            out.insert(0 if key == "sent_id" else len(out), f"# {key} = {updates[key]}")
    # append any newly-set scheme-metadata keys that had no existing comment
    for key in _META_KEYS:
        if key in meta and meta[key] != "" and key not in seen_meta:
            out.append(f"# {key} = {meta[key]}")
    # append any newly-added translations that had no existing comment
    for key in trans_order:
        if key not in seen_trans:
            out.append(f"# {key} = {trans_map[key]}")
    # …and put any newly-set boundary marker at the very TOP, in UD's own order: newdoc, newpar, sent_id,
    # text. Inserted in REVERSE so the two insert(0) calls land the pair the right way round, and after the
    # sent_id insert above so both end up above it.
    for key in reversed(_BOUNDARY_KEYS):
        v = bounds.get(key)
        if v is not None and v is not False and key not in seen_bound:
            out.insert(0, _boundary_line(key, v))
    return out


def serialize(sentences: list[dict]) -> str:
    """Serialise a list of sentence dicts back to CoNLL-U text."""
    blocks = []
    for sent in sentences:
        lines = _update_comments(sent)
        mwt_by_start = {}
        for m in sent.get("mwt") or []:
            mwt_by_start.setdefault(int(m["from"]), m)
        empties_by_after: dict[int, list] = {}
        for e in sent.get("empties") or []:
            empties_by_after.setdefault(int(e.get("after", 0)), []).append(e)

        # empty nodes that precede the first token (after == 0)
        for e in empties_by_after.get(0, []):
            lines.append("\t".join(e["_cols"]))

        for i, tok in enumerate(sent["tokens"], start=1):
            if i in mwt_by_start:
                m = mwt_by_start[i]
                cols = list(m.get("_cols") or ["_"] * 10)
                cols = (cols + ["_"] * 10)[:10]
                cols[0] = f"{m['from']}-{m['to']}"
                cols[1] = _blank(m.get("form"))
                lines.append("\t".join(cols))
            lines.append(_token_line(i, tok))
            for e in empties_by_after.get(i, []):
                lines.append("\t".join(e["_cols"]))
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks) + "\n"


def read_file(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as fh:
        return parse(fh.read())


def write_file(path: str, sentences: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(serialize(sentences))
