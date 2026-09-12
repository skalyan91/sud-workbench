# The two chrome kits

`web/chrome-kit/macos-kit/` (Liquid Glass) and `web/chrome-kit/win11-kit/` (Fluent) — how one is
chosen, what `web/chrome-kit/js/platform.js` owns, and which file a given chrome rule belongs in.

> Every ⚠ below records the diagnosis of a real bug, a measurement, or an
> alternative that was tried and rejected. Preserve that rationale when you edit
> this code — extend a note rather than re-deriving it. See `../../CLAUDE.md`.

**The kits live in a git submodule.** `web/chrome-kit/` is
[skalyan91/pywebview-chrome-kit](https://github.com/skalyan91/pywebview-chrome-kit), extracted from
this app (with full history) so the same chrome can dress other pywebview apps — its own README
explains how a consumer wires it up. It carries `chrome-shared/`, `macos-kit/`, `win11-kit/`,
`adwaita-kit/`, `js/platform.js` and `js/menubar.js`. **A fresh clone must run
`git submodule update --init` before first run or build** — an uninitialised submodule is an empty
directory (no error), which silently ships or runs an app with no window chrome at all. `README.md`
and `CLAUDE.md`'s Commands section both say so; every packaging script asserts the submodule is
populated before it copies `web/` (see `docs/notes/packaging.md`).
Everything else in `web/js/ui/` (`sheets.js`, `find.js`, `wiring.js`, `colours.js`, `toast.js`)
stays **app-resident on purpose** — real annotation logic (parser/translation-tier wiring, the
CoNLL-U search engine, diagram-cache invalidation), not generic chrome, and `toast.js`'s own header
comment records exactly this call being made once already, when the Fluent kit arrived.

**Two chrome kits, one loaded.** `macos-kit/` (Liquid-Glass) and `win11-kit/` (Fluent) are
self-contained, reusable, and **share 150 token names** — that identity is the whole
design: `app.css` consumes tokens and needs no platform branching. Each has its own README. Keep
app-specific rules out of both; app overrides belong in `web/styles/app.css`, which loads after.

The choice is made by an **inline blocking `<script>` in `<head>`**, above the `app.css` link. It
stamps `<html data-platform>` from `?platform=` (design mode) or the UA, then `document.write`s that
kit's two `<link>`s (as `chrome-kit/<kit>/...`). `document.write` and not `head.appendChild` **on
purpose**: it inserts at the script's own source position, so the kit stays ahead of `app.css` in
the cascade however the file is later reordered. Python gets no vote — it can only inject after
load, far too late for a stylesheet.

`chrome-kit/js/platform.js` loads **first** and reads that decision back off `data-platform`, so
look and behaviour cannot disagree. It owns `PLATFORM`/`IS_WIN`, `accel()` (macOS glyphs →
`Ctrl+Shift+Z`), `localiseAccel()` (one idempotent DOM sweep over `title=` and `.kbd` — new tooltips
are localised for free, so **don't** rewrite accelerators at call sites), `cmdKey`/`cmdAltKey`/
`cmdOptKey`, and `uiFont()`/`uiMono()` for the two consumers that need a resolved stack rather than a
`var()`. `chrome-kit/js/menubar.js` (the Windows in-window menu bar) is the submodule's other JS
file — data-driven entirely off `app/menu_spec.py`'s table and this app's `menuState()`/`syncMenu()`
globals, so it carries no SUD-specific logic despite living next to files that do.

⚠️ **Modifier arithmetic.** macOS has five ⌘-families (⌘, ⇧⌘, ⌃⌘, ⌥⌘, ⌥⇧⌘); Windows has four. One
pair *must* collapse, and ⌃⌘/⌥⌘ do. Where that would make two live commands equal, the fix is a
per-item `win_accel` in `app/menu_spec.py` — **not** a change to `accel()`'s generic mapping. Three
exist (Move Token/Sentence → `Ctrl+Shift+arrow`, Toggle Grids → `Ctrl+Alt+Shift+G`). `menu_spec` has
an audit that reports unresolved clashes; run it after adding any shortcut.

**Which file does a chrome rule go in?** If the Fluent kit would need to restyle it, it is chrome
and belongs in the kits (title bar, pills, `.ctx`, `.sheet`/`.scrim`/`.toast`, `.statusbar`,
drawers). If it draws the treebank, it is shared and stays in `app.css` (`.sblock`, the five
notations, `table.grid`, relation colours). Moving a block between the two can **flip a specificity
tie** — that is not hypothetical, it already bit `.gmrow input.gm-feat` once.

`web/js/dev-fixture.js` seeds a sample `DOC` only when there's no bridge (browser design mode).
`packaging/make_*.sh` delete both the file and its `<script>` tag from the bundle, so the shipped
app carries no sample sentences. `samples/` is likewise repo-only — nothing at runtime reads it.
