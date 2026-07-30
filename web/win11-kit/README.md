# win11-kit

A small, self-contained pair of stylesheets that give a [pywebview](https://pywebview.flowmark.dev/)
app the **native Windows 11 (Fluent) look** — a 32px title bar with an icon, a caption-style title,
a menu bar and shell caption buttons, a flat command bar, Fluent menus with their inset backplates,
in-app Acrylic surfaces, and Fluent UI System Icon masks.

This is the sibling of `../macos-kit/`. The two dress the **same DOM** and declare the **same token
names**, so the app's own stylesheet needs no platform branching: `index.html` stamps
`<html data-platform="mac|win">` and loads exactly one kit, ahead of `styles/app.css`.

Everything here is a **plain stylesheet** — no build step, no bundler, no `import`/`export`.

## What's in the box

| File | What it provides |
|---|---|
| `fluent-tokens.css` | CSS custom properties: the UI font stacks (`--ui-font` / `--ui-mono`), the WinUI 3 colour set (light + dark), radii, the Fluent motion durations and easings, the type ramp, and the `--sf-*` icon-mask system redrawn with Fluent UI System Icons. |
| `fluent-chrome.css` | The chrome itself: the title bar, caption buttons, menu bar, command bar, the asymmetric control stroke, focus rings, text fields, menus / autocomplete / flyouts, the options bar and its drawers, the status bar, the modal scrim + dialog, the toast, and the expanding scrollbars. |

Load order matters (cascade): **`fluent-tokens.css` before `fluent-chrome.css`**, and both before
your app's own stylesheet so app rules can override.

```html
<link rel="stylesheet" href="win11-kit/fluent-tokens.css">
<link rel="stylesheet" href="win11-kit/fluent-chrome.css">
<link rel="stylesheet" href="styles/app.css">
```

To preview this skin from a Mac, append `?platform=win` to the page URL — the `<head>` script in
`index.html` takes an explicit `?platform=` over the user agent.

## Where the values come from

Every colour, radius, metric and timing is read out of Microsoft's own **MIT-licensed** WinUI 3
theme resources — [`microsoft/microsoft-ui-xaml`](https://github.com/microsoft/microsoft-ui-xaml),
branch `main`:

| File | What was taken |
|---|---|
| `controls/dev/CommonStyles/Common_themeresources_any.xaml` | the whole colour set |
| `controls/dev/CommonStyles/CornerRadius_themeresources.xaml` | `ControlCornerRadius` 4, `OverlayCornerRadius` 8 |
| `controls/dev/CommonStyles/MenuFlyout_themeresources.xaml` | menu padding, item margin/padding/min-height, separator inset, item states |
| `controls/dev/CommonStyles/ScrollBar_themeresources.xaml` | 12 / 8 / 6px metrics, the 400ms delay and 167ms ramp, the `0,0,0,1` and `1,0,1,1` keysplines |
| `controls/dev/CommonStyles/TextBlock_themeresources.xaml` | Caption 12, Body 14, Subtitle 20; SemiBold as the emphasis weight |
| `controls/dev/TitleBar/TitleBar_themeresources.xaml` | 32/48 heights, the 16px icon, the 16px leading inset, `TitleBarDeactivatedOpacity` |
| `controls/dev/Materials/Acrylic/AcrylicBrush.h` + `AcrylicBrush_themeresources.xaml` | blur 30, noise .02, the in-app tint and its luminosity opacity |

**Two traps when reading those files**, both of which produce plausible-looking wrong values:

- **WinUI hex is `#AARRGGBB` — the alpha byte comes FIRST.** `#0F000000` is black at 6 %, not a
  near-black at full alpha. Everything in `fluent-tokens.css` is written as `rgba()` for exactly
  this reason: an `#RRGGBBAA` that merely *looked* like the source would be the easiest thing to
  mis-copy back.
- **The dictionary keyed `Default` is the DARK theme**; `Light` is light. `HighContrast` is a
  placeholder dictionary full of `#FF0000` — never read a colour out of it.

Anything that could not be derived from those files is marked `APPROX` in `fluent-tokens.css` with
what it is and why. Grep for it. The list is short: the accent shade table (OS-supplied, not in the
repo), the shadow depths (`ThemeShadow` is a compositor effect with no numeric spec), the Acrylic
saturation, the type ramp's line heights, the mockup wallpaper, and the two "slow" durations.

## Two things a web page cannot do

- **Mica and background Acrylic are not reproducible.** Both sample the *desktop* behind the
  window, and `backdrop-filter` only ever sees content inside the page. The kit ships
  `SolidBackgroundFillColorBase` as the opaque base — which is what WinUI itself falls back to when
  a backdrop is unavailable — and leaves real Mica to the native layer
  (`DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE, …)` on the host window). **In-app** Acrylic
  *is* reproducible, samples page content, and is implemented from the published numbers.
- **`::-webkit-scrollbar` has no container-hover selector.** There is no way to write "this
  scrollbar, while its scroller is hovered", so the rest→expanded transition is driven by a rule on
  the scrolling container instead. See the comment on the scrollbar block.

## The detail worth protecting

`ControlElevationBorderBrush` — the asymmetric control stroke — is the single most-often-botched
Fluent detail, and this kit carries the fix in `--ctrl-stroke-grad`. The brush is a 3-device-pixel
ramp from `ControlStrokeColorSecondary` to `ControlStrokeColorDefault`; the **light** dictionary,
and only the light one, wraps it in a `<ScaleTransform ScaleY="-1"/>`, which puts the strong stop on
the **bottom** (a shadow the control sits on). Dark has no transform, so its strong stop stays on
the **top** (a highlight). Reimplementations usually read the stops, miss the `RelativeTransform`,
and mirror dark the wrong way.

Two more that follow from Fluent's elevation model rather than from a colour:

- **A press is *lighter* than a hover** — `SubtleFillColorTertiary` really is a lower alpha than
  `SubtleFillColorSecondary`. A pressed control drops from elevation 2 to 1: the gradient stroke
  collapses to a flat one and the label dims to secondary.
- **A Windows menu row never inverts.** `MenuFlyoutItemForegroundPointerOver` is the same
  `TextFillColorPrimary` as at rest; the hover is a `SubtleFill` backplate **inset 4px from each
  menu edge**, not a full-bleed accent bar.

## Required DOM hooks

Beyond everything `../macos-kit/README.md` lists (the two kits style the same structures), this kit
adds two of its own — both **appearance only**; another module builds and drives them:

- **Caption buttons:** `<div class="capbtns">` pinned to the trailing edge of `.titlebar`, holding
  `<button class="capbtn">` × 3, the last one also carrying `.close`. Each contains an inline SVG
  glyph (Segoe Fluent Icons is not assumed to be installed).
- **Menu bar:** `<div class="menubar">` in the title-bar strip with `<button class="menubar-item">`
  children; add `.open` (or `aria-expanded="true"`) to the one whose flyout is showing.

`.lights` (the macOS traffic lights) and `.tb-blur` (the macOS scroll-edge ramp) are still emitted by
`index.html` and are hidden here rather than left unstyled.

## Third-party attribution

- **Fluent UI System Icons** — [`microsoft/fluentui-system-icons`](https://github.com/microsoft/fluentui-system-icons),
  MIT licence. 38 of the 40 `--sf-*` masks are the 24px `_regular` SVGs from that repo, inlined as
  data URIs at commit `a9e7f2d7bd8a` (2026-07-29). Three of those 38 answer a control this kit does
  NOT dress the same way macOS does, and the reasons are recorded beside each declaration:
  `--sf-cube` is “Brain Circuit” where macOS wears SF Symbol `cube.box`, and the Layout pill's
  `--sf-paged`/`--sf-unpaged` are “Document One Page Multiple”/“Text Column One” where macOS traces
  an inset-filled portrait rectangle twice. The two exceptions, `--sf-narcs` and
  `--sf-nbrackets`, are [Lucide](https://lucide.dev) line drawings (ISC licence) carried over
  unchanged from `../macos-kit/mac-tokens.css`: they draw a *notation* (nested arcs, a bracketed
  span) rather than an OS affordance, Fluent has no equivalent glyph, and drawing a notation
  differently per platform would be a change of meaning rather than of dress.
- **WinUI 3 theme resources** — [`microsoft/microsoft-ui-xaml`](https://github.com/microsoft/microsoft-ui-xaml),
  MIT licence. No code is copied; the values listed above are read from the theme dictionaries.
