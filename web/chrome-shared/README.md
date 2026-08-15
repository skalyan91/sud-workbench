# chrome-shared

Not a fourth chrome kit — a shared base the two token-inheriting kits, `../macos-kit/` and
`../adwaita-kit/`, both build on. (`../win11-kit/` doesn't use this directory at all: every value in
it was independently sourced from Microsoft's own WinUI 3 resources, so it has no need to inherit
from anything — see that kit's own README.)

## Why this exists

`macos-kit/mac-tokens.css` and `macos-kit/mac-chrome.css` used to be the whole of the macOS kit,
and `adwaita-kit/`'s two files `@import`ed them directly to avoid redeclaring ~1,200 lines of
tokens/chrome rules by hand (a real transcription-risk concern, not a shortcut taken lightly — see
`adwaita-kit/README.md`'s own "Why a placeholder, not a third kit"). That worked in dev and in the
macOS build, and broke silently on every real Linux install: `packaging/linux/make_deb.sh` and
`make_rpm.sh` deliberately strip `macos-kit/` from the shipped tree (the same SF-Symbols licensing
reason `packaging/windows/make_win_app.py` drops it from Windows — see `THIRD-PARTY-NOTICES.md`),
so `adwaita-kit/`'s `@import url("../macos-kit/…")` pointed at a directory that simply wasn't there.
A failed CSS `@import` fails silently (zero rules contributed, no thrown error), so this never
crashed anything — a real `.deb`/`.rpm` install just rendered completely unstyled.

The fix: split `mac-tokens.css`/`mac-chrome.css` into "everything with zero Apple-restricted
content" (→ here) and "the eight real SF Symbols" (→ stays in `macos-kit/`, rendered at packaging
time by `app/mac/sf_symbols.py`). This directory is never stripped by any platform's build — it
carries nothing Apple-specific to strip.

## What's in the box

| File | What it provides |
|---|---|
| `base-tokens.css` | Everything `macos-kit/mac-tokens.css` used to declare directly — fonts, the Liquid-Glass token set, hairlines/radii/accents, the notation-glyph masks, 33 of the 41 `--sf-*` icon masks — split out verbatim, **except** the eight `--sf-*` names that are real SF Symbols on macOS (undo/redo/zoom in/zoom out/actual size/help/grid/open), which this file gives Fluent UI System Icons equivalents instead (copied verbatim from `win11-kit/fluent-tokens.css`, MIT-licensed), so every consumer gets a complete 41-name set with zero Apple content. |
| `base-chrome.css` | `macos-kit/mac-chrome.css`'s content, verbatim and unchanged — it was already 100% token-driven (no literal Apple-specific rules of its own), so moving it cost nothing. |

## How each kit uses it

- **`macos-kit/mac-tokens.css`** is now a thin shell: `@import url("../chrome-shared/base-tokens.css");`
  followed by `@import url("mac-tokens-sf.generated.css");` — the packaging-time-rendered real SF
  Symbols. Import order matters: the second `@import` wins at equal specificity (later in source
  order), so macOS still gets the real symbols; this file's own Fluent fallbacks are what every
  *other* consumer sees undisturbed.
- **`macos-kit/mac-chrome.css`** is now `@import url("../chrome-shared/base-chrome.css");` and
  nothing else.
- **`adwaita-kit/adwaita-tokens.css`** / **`adwaita-chrome.css`** `@import` these two files directly
  (not `macos-kit/`'s versions) and layer their own Adwaita overrides on top, same as before.

## Packaging

Ships on every platform unconditionally — no packaging script targets this directory for removal,
and none needs to: `packaging/windows/make_win_app.py`'s `skip_win` predicate matches only a
directory literally named `macos-kit`, and `packaging/linux/make_deb.sh`/`make_rpm.sh` only
`rm -rf` `macos-kit/` and `win11-kit/` by name. A future kit-stripping change should keep it that
way — this directory has nothing in it that any platform has a reason to drop.
