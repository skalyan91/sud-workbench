#!/usr/bin/env python3
"""Build ``app/data/tshet_uinh_mc.tsv`` — Baxter's Middle Chinese transcription for every character
in the 廣韻, DERIVED from its 音韻地位 rather than looked up in a word list.

WHY THIS EXISTS.  ``app/data/baxter_sagart.tsv`` is Wiktionary's Baxter–Sagart appendix, and that is a
list of 4,082 WORDS chosen for what they say about *Old* Chinese.  It is not, and was never meant to be,
a Middle Chinese dictionary: it covers 4,330 graphs, so anything outside its editorial scope simply has
no Middle Chinese at all in this app — including a great deal of the ordinary Buddhist-text vocabulary
(菩薩, 涅槃, 般若 …), which is exactly where a reader wants Middle Chinese most.

The Qieyun system does not have that gap.  A character's 音韻地位 — its 母 (initial), 呼 (rounding),
等 (division), 類 (the 重紐 A/B distinction), 韻 (rhyme) and 聲 (tone) — is recorded in the rhyme book for
every one of the ~20,000 graphs it lists, and Baxter's transcription is a NOTATION FOR THAT POSITION: it
is derived, not attested, so anything with a position has one.  This script does the derivation.

SOURCES, both fetched rather than vendored as code:
  · the positions — ``nk2028/tshet-uinh-data``'s ``韻書/廣韻.csv`` (廣韻 澤存堂本 with corrections), CC0.
  · the derivation — a port of ``nk2028/tshet-uinh-examples``'s ``baxter.js`` (MIT), which states the
    initial and rhyme tables and the five adjustment rules below.  Ported to Python rather than run
    under node, so the build needs nothing but this interpreter, and read line by line against the
    original: every table entry and every rule here is that file's, in its order.

  Baxter, W. H. (1992). *A Handbook of Old Chinese Phonology*. De Gruyter Mouton.
  Baxter, W. H., & Sagart, L. (2014). *Old Chinese: A New Reconstruction*. Oxford University Press.

OUTPUT — three tab-separated columns, one row per (graph, position), in 廣韻 order:

    graph · middle_chinese · 音韻地位

The third column is the position the transcription was derived FROM, carried so a reading can be checked
against the rhyme book without re-running the build.  The COLUMN COUNT IS A CONTRACT with
``translit._tshet_uinh_rows``, which skips a short row rather than padding it — the same guard, and for
the same reason, as the six-column one on ``baxter_sagart.tsv``: a file from an older shape must leave
the table EMPTY (no Middle Chinese) rather than fill it with fields read one column across.

BYTE-REPRODUCIBLE: no clock is read (``--retrieved`` is required, for exactly that reason — two builds of
one input must not differ), no dict iteration order escapes into the output.  So don't hand-edit the file;
re-run the script.

    python3 tools/build_tshet_uinh_baxter.py --retrieved 2026-08-04
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import sys
import urllib.request

GY_URL = ("https://raw.githubusercontent.com/nk2028/tshet-uinh-data/main/"
          "%E9%9F%BB%E6%9B%B8/%E5%BB%A3%E9%9F%BB.csv")

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "app", "data", "tshet_uinh_mc.tsv")

# ── the 音韻地位 description, as nk2028 writes it ────────────────────────────────────────────────
# 母 [呼] 等 [類] 韻 聲 — e.g. 端一東平, 影開二銜入, 並三C尤上.  Verified against all 3,801 distinct
# descriptions in the 廣韻 file: every one matches this shape exactly, with 呼 and 類 each optional.
_TONES = "平上去入"
_HU = "開合"
_DENG = "一二三四"
_LEI = "ABC"


def parse_position(desc: str):
    """``音韻地位`` string → ``(母, 呼, 等, 類, 韻, 聲)``; ``呼``/``類`` are "" when absent."""
    if len(desc) < 4 or desc[-1] not in _TONES:
        return None
    mu, tone, rhyme = desc[0], desc[-1], desc[-2]
    hu = lei = deng = ""
    for ch in desc[1:-2]:
        if ch in _HU:
            hu = ch
        elif ch in _DENG:
            deng = ch
        elif ch in _LEI:
            lei = ch
        else:
            return None
    if not deng:
        return None
    return mu, hu, deng, lei, rhyme, tone


# ── baxter.js, ported ────────────────────────────────────────────────────────────────────────────
_INITIAL = {
    "幫": "p",   "滂": "ph",   "並": "b",   "明": "m",
    "端": "t",   "透": "th",   "定": "d",   "泥": "n",  "來": "l",
    "知": "tr",  "徹": "trh",  "澄": "dr",  "孃": "nr",
    "精": "ts",  "清": "tsh",  "從": "dz",                     "心": "s",  "邪": "z",
    "莊": "tsr", "初": "tsrh", "崇": "dzr",                    "生": "sr", "俟": "zr",
    "章": "tsy", "昌": "tsyh", "常": "dzy", "日": "ny",         "書": "sy", "船": "zy", "以": "y",
    "見": "k",   "溪": "kh",   "羣": "g",   "疑": "ng",
    "影": "'",   "曉": "x",    "匣": "h",                                              "云": "h",
}

_RHYME = {
    # 一等韻
    "東": "uwng", "冬": "owng", "模": "u", "泰": "aj", "灰": "oj", "咍": "oj",
    "魂": "on", "痕": "on", "寒": "an", "豪": "aw", "歌": "a", "唐": "ang",
    "登": "ong", "侯": "uw", "覃": "om", "談": "am",
    # 二等韻
    "江": "aewng", "佳": "ea", "皆": "eaj", "夬": "aej", "刪": "aen", "山": "ean",
    "肴": "aew", "麻": "ae", "庚": "aeng", "耕": "eang", "咸": "eam", "銜": "aem",
    # 四等韻
    "齊": "ej", "先": "en", "蕭": "ew", "青": "eng", "添": "em",
    # 三等陰聲韻
    "支": "je", "脂": "ij", "之": "i", "微": "j+j", "魚": "jo", "虞": "ju",
    "祭": "jej", "廢": "joj", "宵": "jew", "尤": "juw", "幽": "jiw",
    # 三等陽聲韻
    "鍾": "jowng", "真": "in", "臻": "in", "文": "jun", "殷": "j+n", "元": "jon",
    "仙": "jen", "陽": "jang", "清": "jeng", "蒸": "ing", "侵": "im", "鹽": "jem",
    "嚴": "jaem", "凡": "jom",
}

_ZHANG = set("章昌常書船")          # 章組
_RI_YI = set("日以")                # 日以母
_MA_YOU_YANG = set("麻幽陽")
_YU_WEN_FAN = set("虞文凡")
_HUI_HUN = set("灰魂")
_DONG_GE_MA_GENG = set("東歌麻庚")


def baxter(pos, version: str = "2014-ipa") -> str:
    """One 音韻地位 → Baxter's transcription, or "" where the tables do not cover it."""
    mu, hu, deng, lei, rhyme, tone = pos
    initial = _INITIAL.get(mu)
    if initial is None:
        return ""
    # The tables below are natively 2014/ASCII; every version but that one converts back from them.
    if version != "2014" and initial == "'":
        initial = "ʔ"
    final = _RHYME.get(rhyme)
    if final is None:
        return ""
    # 東歌麻庚韻 also hold a 三等; the table above covers only their non-三等 rows
    # ("四等" here counts 端組 in, exactly as the source comment says).
    if rhyme in _DONG_GE_MA_GENG and deng in "三四":
        final = "j" + final
    # ⚠ THE 佳 RHYME IS THE ONE PLACE THE TWO EDITIONS DISAGREE ABOUT A READING RATHER THAN A SPELLING.
    # Baxter (1992) writes it -ɛɨ/-wɛɨ; Baxter & Sagart (2014) replace those with -ea/-wea, which in
    # this transcription is the ordinary ɛ vowel — so the rhyme stops having a notation of its own.
    # Everything else that separates the two editions is pure ASCII encoding of the SAME sounds
    # (' ae ea + for ʔ æ ɛ ɨ), which is why "which edition" and "which characters" are two questions
    # and this script now lets them be answered separately.
    if version == "1992":
        if final == "ea":
            final = "ɛɨ"
    if version != "2014":
        final = final.replace("+", "ɨ").replace("ae", "æ").replace("ea", "ɛ")
    # 章組 and 日/以母 pair only with 三等韻, so the final's leading j is redundant
    if (mu in _ZHANG or mu in _RI_YI) and final.startswith("j"):
        final = final[1:]
    # 重紐 A 類 adds j or i
    if lei == "A" and rhyme not in _MA_YOU_YANG:
        final = ("ji" + final[1:]) if final.startswith("j") else ("j" + final)
    # 合口字 adds w
    if (hu == "合" or rhyme in _HUI_HUN) and rhyme not in _YU_WEN_FAN:
        final = ("jw" + final[1:]) if final.startswith("j") else ("w" + final)
    if tone == "入":
        if final.endswith("m"):
            final = final[:-1] + "p"
        elif final.endswith("ng"):
            final = final[:-2] + "k"
        elif final.endswith("n"):
            final = final[:-1] + "t"
    return initial + final + {"上": "X", "去": "H"}.get(tone, "")


# ── the 字頭 field's own annotations ─────────────────────────────────────────────────────────────
def head_char(raw: str) -> str:
    """The character an entry is FOR, or "" for an entry that should not be in the table.

    The field carries the rhyme book's editorial apparatus: ``［嬹］`` is a character supplied by the
    editors (keep it, it is a real reading), ``｛𪈥｝`` is one they judge should be struck (drop it), and
    ``汦〈泜〉`` is a corrected misprint whose ANGLE-BRACKETED form is the correction (take that one)."""
    s = (raw or "").strip()
    if not s or s.startswith("｛"):
        return ""
    if "〈" in s and s.endswith("〉"):
        s = s[s.index("〈") + 1:-1]
    s = s.strip("［］")
    return s if len(s) == 1 else ""


def build(src: str | None, retrieved: str, version: str) -> str:
    if src:
        with open(src, encoding="utf-8") as fh:
            text = fh.read()
    else:
        with urllib.request.urlopen(GY_URL) as resp:          # noqa: S310 — a fixed https URL
            text = resp.read().decode("utf-8")
    rows: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str]] = set()
    skipped = 0
    for rec in csv.DictReader(io.StringIO(text)):
        ch = head_char(rec.get("字頭", ""))
        if not ch:
            continue
        desc = (rec.get("音韻地位") or "").strip()
        pos = parse_position(desc)
        if pos is None:
            skipped += 1
            continue
        mc = baxter(pos, version)
        if not mc:
            skipped += 1
            continue
        key = (ch, mc)
        if key in seen:      # the same graph in the same 小韻 twice — one reading, listed once
            continue
        seen.add(key)
        rows.append((ch, mc, desc))
    out = io.StringIO()
    label = {"2014-ipa": "Baxter & Sagart 2014 readings in Baxter 1992's characters",
             "1992": "Baxter 1992 transcription",
             "2014": "Baxter & Sagart 2014 transcription, ASCII"}[version]
    out.write(f"# Baxter Middle Chinese derived from the 廣韻 音韻地位 ({label}).\n")
    out.write("# Positions: nk2028/tshet-uinh-data 韻書/廣韻.csv (CC0). Derivation: a Python port of\n")
    out.write("# nk2028/tshet-uinh-examples baxter.js (MIT). Built by tools/build_tshet_uinh_baxter.py;\n")
    out.write(f"# retrieved {retrieved}. Columns: graph, middle_chinese, 音韻地位. DO NOT HAND-EDIT.\n")
    for r in rows:
        out.write("\t".join(r) + "\n")
    print(f"{len(rows)} readings over {len({r[0] for r in rows})} graphs "
          f"({skipped} entries skipped: no position, or a position the tables don't cover)",
          file=sys.stderr)
    return out.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--retrieved", required=True,
                    help="YYYY-MM-DD the source was fetched. Required: reading the clock here would "
                         "make two builds of one input differ.")
    ap.add_argument("--src", help="a saved copy of 廣韻.csv (default: fetch it)")
    ap.add_argument("--version", default="2014-ipa", choices=["2014-ipa", "1992", "2014"],
                    help="which Baxter transcription. Default 2014-ipa: the 2014 READINGS written with\n"
                         "1992's characters (ʔ æ ɛ ɨ, not ' ae ea +) — which is exactly what\n"
                         "app/data/baxter_sagart.tsv holds, and the two tables answer the same Displayed\n"
                         "row, so they must not disagree. `1992` restores that edition's own -ɛɨ/-wɛɨ for\n"
                         "the 佳 rhyme; `2014` is the plain ASCII transcription, characters and all.")
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    text = build(a.src, a.retrieved, a.version)
    with open(a.out, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    print(f"wrote {a.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
