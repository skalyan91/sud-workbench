# macos-kit

A small, self-contained set of front-end modules that give a [pywebview](https://pywebview.flowmark.dev/)
app the **native macOS look** — a unified Liquid-Glass title bar with traffic lights, grouped
toolbar pills, popup menus, context menus, a status bar, dialog sheets, and SF-Symbol icon masks.
Extracted from SUD Workbench so the same chrome can dress other pywebview apps.

It has a sibling: `../win11-kit/` dresses the same DOM in Windows 11 Fluent. The two declare the
**same token names** and cover the **same selectors**, so the app stylesheet needs no platform
branching — `index.html` loads exactly one of them.

Everything here is a **classic script / plain stylesheet** — no build step, no bundler, no
`import`/`export`. Drop the files in and reference them from your `index.html`.

## What's in the box

| File | What it provides |
|---|---|
| `mac-tokens.css` | CSS custom properties: the UI font stacks (`--ui-font` / `--ui-mono`), the macOS 26 "Tahoe" Liquid-Glass token set (light + dark), the SF-Symbol icon-mask system (`--sf-*` masks recoloured via `currentColor`), accent/hairline/radius tokens, and the notation-glyph masks. |
| `mac-chrome.css` | The chrome itself, in two halves. **Window and toolbar:** the window card, traffic lights, unified title bar, grouped translucent pills + hairline dividers, the three titlebar display modes (Icon Only / Icon and Text / Text Only), the `.fpmenu` popup menu, the Finder-style search capsule and find bar, the options bar and its checkbox rows. **Everything else that is chrome** (below the banner near the end of the file, moved here from the app's own stylesheet): the drawer pull-down + popover, the status bar with its count pills and busy indicator, the `.ctx` context menu / `.acmenu` autocomplete / `.ctx-sub` flyout family, the `.scrim` + `.sheet` dialog shell and its buttons, the `.toast`, and the `.fmtpill` status-bar pull-down. |
| `toast.js` | *(no longer here — this app moved it to `../js/ui/toast.js`, since it is script rather than chrome and both platform kits share it.)* `toast(msg)` shows a transient bottom-of-window status message and needs a `<div class="toast" id="toast"></div>` in the body; `mac-chrome.css` still styles that element. |

**What is deliberately NOT here:** anything that draws the *document*. In SUD Workbench that is
`styles/app.css` — the sentence blocks, the five diagram notations, the annotation grid, the
relation colours. The dividing test is simply whether the Fluent kit would have to restyle it.

Load order matters (cascade): **`mac-tokens.css` before `mac-chrome.css`**, and both before
your app's own stylesheet so app rules can override.

### Calibrated hairline/border values (light mode)

`--hairline` covers most plain dividers in the app at once (`rgba(0,0,0,.9)`), but a few
categories were measured against Figma/on request and split out into their own tokens instead of
sharing it — keep these in sync if you retune the ramp:

| Token | Value | Consumer |
|---|---|---|
| `--viewbar-border` | `rgb(230,230,230)` | the border below the options bar (`.viewbar`) |
| `--sheet-border` | `rgba(0,0,0,.23)` | modal dialog (`.sheet`) border |
| `--field-border` | `rgba(0,0,0,.08)` | text-input/textarea border |
| `--grid-head-border` / `--grid-col-border` | `rgba(0,0,0,.05)` / `rgba(0,0,0,.10)` | the grid header's bottom rule / column-header divider |

The page (`.docsheet`) and block (`.sblock`) carry **no border at all**, on request — a page reads
as lifted paper via `--page-shadow` alone, and a block is set off from its neighbours by padding/
whitespace, not a rule. (A `--page-border` token briefly existed here at `rgb(156,156,156)` and was
removed outright rather than recoloured again — don't reintroduce it via `--hairline`.)

Dark-mode counterparts live in `mac-tokens.css`'s `@media (prefers-color-scheme:dark)` block —
several are independently measured against the dark ground (`rgb(30,30,30)`) rather than a blind
alpha flip; see that block's own comments before changing one.

Grid row corner rounding (`--grid-row-r`, `table.grid tbody td::before`) matches the grid frame's
own radius (`--grid-r`): both `8px`.

```html
<link rel="stylesheet" href="macos-kit/mac-tokens.css">
<link rel="stylesheet" href="macos-kit/mac-chrome.css">
<link rel="stylesheet" href="styles/app.css">
...
<script src="js/…"></script>   <!-- your app modules -->
```

In SUD Workbench that pair is chosen at runtime instead: an inline `<head>` script stamps
`<html data-platform="mac|win">` and `document.write`s either this kit or `win11-kit`'s, at its own
position in the source so the kit always lands ahead of `app.css`. See `web/index.html`.

## Required DOM hooks

The chrome CSS styles these structures — reproduce the class/id names:

- **Window frame:** `<div class="window">` wrapping everything; `html.mockup` on the root draws
  the rounded card + shadow when running in a plain browser (no native window), otherwise the
  app fills the real native window.
- **Title bar:** `<div class="titlebar">` with `<div class="lights"><i class="r"></i><i class="y"></i><i class="g"></i></div>`
  for the traffic lights, and `.tbpill` / `.tbgroup` / `.tbtn` for grouped toolbar buttons.
  Add `win-inactive` to `.titlebar` to dim it when the window loses focus.
  The bar paints nothing itself: its tint and blur live on `.titlebar`'s own `::before`/`::after` as
  a two-layer **masked-alpha ramp**, the **scroll edge effect**: two fixed-radius `backdrop-filter`
  layers, each revealed by its own raised-cosine alpha mask, so the tint/blur fades smoothly toward
  the bar's own bottom edge instead of meeting a hard line, the way macOS 26 ends a toolbar. A six-
  slice genuinely-varying-blur-radius version (matching iOS's `UIVariableBlurEffect`) was tried here
  too, but cost 6 `backdrop-filter` compositing layers instead of 2 and read as visibly laggy/stripy
  in real use, for a result the masked ramp already reproduced by eye — removed back to the ramp. The
  kit collapses the ramp to one flat hard-edged recipe (no taper, no mask) whenever an options bar
  (`.viewbar`, not `.hidden`) sits under the title bar, since that edge then meets another bar rather
  than content. Override `--tb-tint`, not `background`, to retint
  the bar.
- **An opaque surface that must match the bar** (a page ground behind sheets, say) takes
  `--toolbar-solid`, not `--toolbar-bg`: the bar's tint is translucent, so reusing that value over a
  different backdrop composites to a different colour. `--toolbar-solid` is the flattened result.
- **Popup menus:** build a `<div class="fpmenu">` with `.fpitem` rows (optional `.fpcheck` tick
  column); the kit styles it, your app positions and fills it.
- **Toast:** `<div class="toast" id="toast">`.
- **Context menu:** `<div class="ctx" id="ctx">` filled with `<button>` rows (`.kbd` shortcut,
  `.hdr` section header, `<hr>` separator, `.ck` tick, `.subarr` submenu chevron); a flyout is the
  same box plus `.ctx-sub`.
- **Dialog:** `<div class="scrim" id="scrim"><div id="scrimHost"></div></div>` (plus the
  `confirmScrim`/`confirmHost` pair), holding a `.sheet` with `header` / `.content` / `.actions`.
- **Status bar:** `<div class="statusbar">` of `.pill` spans; a pill that opens a menu adds
  `.fmtpill` and ends with a `.pillchev` SVG.
- **Drawer:** `<div class="drawer">` with a `.drawer-btn` and a `.drawer-pop`; `.open` on the
  wrapper reveals the pop.

## The Python companion layer (native side)

The truly-native touches can't be done from CSS alone; in SUD Workbench they live in
`app/__main__.py` and drive the web layer over the pywebview bridge (`window.evaluate_js`).
Lift these alongside the kit if you want the full effect:

- **Unified title bar** — hides the native OS title bar and lets web content fill up under the
  traffic lights (WKWebView + AppKit; `NSWindow` styleMask / `titlebarAppearsTransparent`).
- **Draggable title bar** — a transparent AppKit view above the webview makes the empty title-bar
  regions drag the window (WKWebView ignores `-webkit-app-region: drag`). Regions are measured in
  CSS px and pushed to Python; call the remeasure hook when the toolbar reflows.
- **SF-Symbol PNG masks** — the native side renders real SF Symbols and pushes them via
  `window.__setSfSymbol(name, dataURL)`, upgrading the CSS `--sf-*` fallback masks pixel-for-pixel.
- **Window focus** — `NSWindow` becomeKey/resignKey → `window.__setWindowActive(bool)` toggles the
  `win-inactive` dimming.

## App-resident helpers you can lift

A few chrome behaviours stayed in the app modules because they're wired to app-specific
selectors/builders rather than being drop-in generic. They're small and easy to adapt:

- **Dialog-sheet shell** — `openSheet` / `closeSheet` / `askConfirm` (a styled `window.confirm`
  replacement) in `../js/ui/sheets.js`, styled by `mac-chrome.css`'s `.sheet` / `.scrim` rules.
  Needs `#scrim`/`#scrimHost` and `#confirmScrim`/`#confirmHost` host elements.
- **SF-Symbol setter** — `window.__setSfSymbol` / `applySfSymbol` in `../js/io/bridge.js` (its
  which→selector map is app-specific).
- **Shared autocomplete dropdown** (`_acMenu`, `acShow*`) and the `.fpmenu` popup positioners in
  `../js/grid/grid.js` / `../js/editing/context-menu.js`.
