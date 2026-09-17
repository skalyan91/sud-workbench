#!/usr/bin/env python3
"""Build ``app/data/lxgw_seal.tsv`` — the vendored Small Seal Script (小篆) codepoint index
:mod:`app.translit` reads for the Literary Chinese "Small Seal Script" Script option — from

    LXGW Seal ("霞鹜篆书"), documentation/table.md
    https://github.com/lxgw/LxgwSeal/blob/<tag>/documentation/table.md

which pairs each of the font's Unicode 18.0 Seal-block codepoints (U+3D000-U+3FC3F, the
"Small Seal" block WG2 N5344R proposed and UTC accepted for that version) with the modern Han
codepoint(s) it stands for. SIL OFL 1.1 (the font's own ``OFL.txt``, vendored verbatim at
``web/fonts/LXGW-Seal-OFL.txt`` beside the font file it covers).

Run it whenever the vendored font is re-pulled to a newer tag; nothing at app runtime calls it::

    tools/build_lxgw_seal_index.py --retrieved 2026-09-18                       # downloads table.md
    tools/build_lxgw_seal_index.py --retrieved 2026-09-18 --src table.md        # from a saved copy

``--tag`` MUST name the exact release the vendored ``web/fonts/lxgwseal.ttf`` was built from
(default: the tag this file was first built against) — the table and the font's own cmap must
list the same character count, or the table would offer a script conversion the font cannot
draw a glyph for. ``--retrieved`` is REQUIRED and not defaulted from the clock, for the same
byte-reproducibility reason ``build_baxter_index.py`` gives.

**The table's shape.** One markdown row per seal character: 篆字 (the seal codepoint + glyph),
对应正字（本字） (its "proper"/original Shuowen headword), 简化字（规范字） (the PRC-standard
simplified spelling, where the simplification is the SAME word — some simplification MERGERS,
e.g. 穀→谷, are deliberately withheld: the source marks the withheld cell with markdown
strikethrough, ``~~\\`U+8C37\\`谷~~``, and this script honours that by skipping a
strikethrough-wrapped cell entirely rather than reading its codepoint anyway), 直接隶定字 (a
regular-script form that directly transcribes the seal shape — added to the mapping only where
it falls in the CJK Unified Ideographs / Extension A range, per the source's own rule 3; entries
outside that range are wrapped in the source's own parentheses as reference-only and this script
skips anything so wrapped), and 后起字或其他异体 (a later-evolved or variant character — the
source's own collection principle 3 says some of these get an explicit mapping to the seal glyph
too, e.g. 花 for 華/华, so this script includes them under the same strikethrough/parenthesis
rules as every other column rather than treating the column name as disqualifying). A cell may
hold more than one codepoint, ``<br>``-joined (直接隶定字's own two-form rows); each is checked
for strikethrough/parenthesis independently.

**Output**: one row per (seal codepoint, modern codepoint) pair — so 連/连 (U+3D52F) become two
rows to the same seal glyph, exactly as 華/华/花 (U+3E1B2) become three. ``app.translit``'s
engine looks up a Han character in the MODERN→seal direction and leaves anything absent from the
table untouched (the font currently draws only the preview's own 105 seal characters), matching
the "degrade, don't hard-fail" rule every other partial-coverage table in this app already
follows.
"""
from __future__ import annotations

import argparse
import re
import sys
import urllib.request

DEFAULT_TAG = "v0.001-alpha.7.24"
SRC_URL_TMPL = "https://raw.githubusercontent.com/lxgw/LxgwSeal/{tag}/documentation/table.md"
OUT = "app/data/lxgw_seal.tsv"
_UA = "sud-workbench-build-script (+https://github.com/skalyan91/sud-workbench)"

_CP_ENTRY = re.compile(r"`U\+([0-9A-Fa-f]+)`(\S)")
_OPEN_PARENS = ("(", "（")
_CLOSE_PARENS = (")", "）")


def _row_re() -> re.Pattern:
    # One data row: 6 pipe-delimited cells, the first always a seal `U+XXXXX`+glyph pair.
    return re.compile(r"^\|\s*`U\+([0-9A-Fa-f]+)`(\S)\s*\|(.*)\|(.*)\|(.*)\|(.*)\|(.*)\|\s*$")


def _cell_entries(cell: str) -> list[str]:
    """The modern codepoint(s) a table CELL maps to a seal glyph — "" for a blank cell.

    Splits ``<br>``-joined sub-entries, drops one wrapped in the source's own ``~~strikethrough~~``
    (an explicit withheld mapping — see module docstring, the 穀/谷 case) or in matching parentheses
    (the source's own "reference only" marker), and extracts the single ``U+XXXX``+glyph pair from
    what remains. A sub-entry with no recognisable ``U+XXXX`` token (there are none in the current
    105-row table, but a future row citing a bare character with no codepoint would otherwise be
    silently mis-parsed as covering the ENTIRE cell) is skipped rather than guessed at."""
    out = []
    for piece in cell.split("<br>"):
        p = piece.strip()
        if not p:
            continue
        # A footnote marker (e.g. "[^1]") can trail the closing bracket/paren — strip it before
        # checking the wrapping, or the wrapped span's own closing character is hidden behind it
        # and a reference-only entry is read as a real one (caught on 萬's own footnoted row: the
        # source itself calls that codepoint chart's answer unreliable, in the footnote this strips).
        p = re.sub(r"\[\^\d+\]\s*$", "", p).strip()
        if not p:
            continue
        if p.startswith("~~") and p.endswith("~~"):
            continue
        if p[0] in _OPEN_PARENS and p[-1] in _CLOSE_PARENS:
            continue
        m = _CP_ENTRY.search(p)
        if m:
            out.append(chr(int(m.group(1), 16)))
    return out


def parse_rows(raw: str) -> list[tuple[str, str, list[str], str]]:
    """→ ``[(seal_cp_hex, seal_char, [han_char, …], note), …]``, source order."""
    rows = []
    row_re = _row_re()
    for line in raw.splitlines():
        m = row_re.match(line)
        if not m:
            continue
        seal_cp, seal_char, c2, c3, c4, c5, note = m.groups()
        han = []
        for cell in (c2, c3, c4, c5):
            for ch in _cell_entries(cell):
                if ch not in han:   # a later-form column occasionally repeats an earlier one verbatim
                    han.append(ch)
        rows.append((seal_cp.upper(), seal_char, han, note.strip()))
    return rows


def header(retrieved: str, tag: str) -> str:
    return (
        "# Small Seal Script (小篆) codepoints (Unicode 18.0, U+3D000-U+3FC3F \"Seal\" block) mapped\n"
        "# to their modern Han equivalent(s) -- one row per (seal codepoint, modern codepoint) pair,\n"
        "# so a character with both an original and a simplified/variant spelling gets one row per\n"
        "# spelling to the SAME seal glyph.  Columns: seal_cp, seal_char, han_char, note.\n"
        "# Source: LXGW Seal (\"霞鹜篆书\"), documentation/table.md\n"
        f"#   https://github.com/lxgw/LxgwSeal/blob/{tag}/documentation/table.md\n"
        f"#   Retrieved {retrieved}, tag {tag} (105-character preview).  SIL OFL 1.1 --\n"
        "#   see web/fonts/LXGW-Seal-OFL.txt, vendored beside the font this table indexes.\n"
    )


def build(raw: str, dst: str, retrieved: str, tag: str) -> None:
    import os
    rows = parse_rows(raw)
    if not rows:
        raise SystemExit("no data rows parsed out of table.md -- source format has changed")
    seen: dict[str, str] = {}
    out_rows = []
    for seal_cp, seal_char, han_chars, note in rows:
        for h in han_chars:
            if h in seen and seen[h] != seal_char:
                raise SystemExit(f"{h!r} maps to two different seal glyphs: "
                                  f"U+{ord(seen[h]):05X} and U+{ord(seal_char):05X} -- "
                                  "resolve by hand before rebuilding")
            seen[h] = seal_char
            out_rows.append((seal_cp, seal_char, h, note))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(header(retrieved, tag))
        for seal_cp, seal_char, han_char, note in out_rows:
            fh.write(f"{seal_cp}\t{seal_char}\t{han_char}\t{note}\n")
    print(f"{dst}: {len(out_rows)} rows over {len(rows)} seal characters "
          f"({len(seen)} distinct modern codepoints)")


def main() -> None:
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    ap.add_argument("--retrieved", required=True, metavar="YYYY-MM-DD",
                    help="the date table.md was fetched -- written into the output header. "
                         "Required, and deliberately NOT defaulted from the clock: the build must "
                         "be byte-reproducible from the same input.")
    ap.add_argument("--tag", default=DEFAULT_TAG,
                    help=f"the LxgwSeal release tag to pull table.md from (default: {DEFAULT_TAG}, "
                         "the tag web/fonts/lxgwseal.ttf was vendored from)")
    ap.add_argument("--src", help="local copy of table.md (default: download from --tag)")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.retrieved):
        raise SystemExit("--retrieved must be an ISO date, YYYY-MM-DD")
    if args.src:
        with open(args.src, encoding="utf-8") as fh:
            raw = fh.read()
    else:
        url = SRC_URL_TMPL.format(tag=args.tag)
        print(f"downloading {url} …", file=sys.stderr)
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req) as resp:   # noqa: S310 — a fixed https URL
            raw = resp.read().decode("utf-8")
    build(raw, args.out, args.retrieved, args.tag)


if __name__ == "__main__":
    main()
