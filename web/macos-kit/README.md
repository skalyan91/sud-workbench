# macos-kit

A small, self-contained set of front-end modules that give a [pywebview](https://pywebview.flowmark.dev/)
app the **native macOS look** — a unified Liquid-Glass title bar with traffic lights, grouped
toolbar pills, popup menus, dialog sheets, and SF-Symbol icon masks. Extracted from SUD
Workbench so the same chrome can dress other pywebview apps.

Everything here is a **classic script / plain stylesheet** — no build step, no bundler, no
`import`/`export`. Drop the files in and reference them from your `index.html`.

## What's in the box

| File | What it provides |
|---|---|
| `mac-tokens.css` | CSS custom properties: the macOS 26 "Tahoe" Liquid-Glass token set (light + dark), the SF-Symbol icon-mask system (`--sf-*` masks recoloured via `currentColor`), accent/hairline/radius tokens, and the notation-glyph masks. |
| `mac-chrome.css` | The chrome itself: the window card, traffic lights, unified title bar / toolbar, grouped translucent pills + hairline dividers, the three titlebar display modes (Icon Only / Icon and Text / Text Only), the `.fpmenu` popup-menu styling, the Finder-style search capsule, and the dialog-sheet shell. |
| `toast.js` | `toast(msg)` — a transient bottom-of-window status message. Needs a `<div class="toast" id="toast"></div>` in the body. |

Load order matters (cascade): **`mac-tokens.css` before `mac-chrome.css`**, and both before
your app's own stylesheet so app rules can override.

```html
<link rel="stylesheet" href="macos-kit/mac-tokens.css">
<link rel="stylesheet" href="macos-kit/mac-chrome.css">
<link rel="stylesheet" href="styles/app.css">
...
<script src="macos-kit/toast.js"></script>
<script src="js/…"></script>   <!-- your app modules -->
```

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
  replacement) in `../js/sheets.js`, styled by `mac-chrome.css`'s `.sheet` / `.scrim` rules.
  Needs `#scrim`/`#scrimHost` and `#confirmScrim`/`#confirmHost` host elements.
- **SF-Symbol setter** — `window.__setSfSymbol` / `applySfSymbol` in `../js/bridge.js` (its
  which→selector map is app-specific).
- **Shared autocomplete dropdown** (`_acMenu`, `acShow*`) and the `.fpmenu` popup positioners in
  `../js/grid.js` / `../js/context-menu.js`.
