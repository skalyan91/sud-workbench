# adwaita-kit

A **placeholder** stylesheet pair that gives a [pywebview](https://pywebview.flowmark.dev/) app a
GNOME/Adwaita-esque look, so the app stops defaulting to the macOS skin on Linux while there is no
native chrome to back it up. This is the sibling of `../macos-kit/` and `../win11-kit/` in name
only — it does not carry their level of fidelity, and says so throughout. See the "Why a
placeholder, not a third kit" section before treating any value here as authoritative.

Like the other two kits, it dresses the **same DOM** and declares the **same token names**:
`index.html` stamps `<html data-platform="mac|win|linux">` and loads exactly one kit, ahead of
`styles/app.css`.

Everything here is a **plain stylesheet** — no build step, no bundler, no `import`/`export`. Both
files lean on CSS's own `@import` to inherit `macos-kit/`'s tokens and chrome wholesale, then
override the subset that should look different — see each file's own header comment for exactly
what that subset is and why the rest was left alone.

```html
<link rel="stylesheet" href="adwaita-kit/adwaita-tokens.css">
<link rel="stylesheet" href="adwaita-kit/adwaita-chrome.css">
<link rel="stylesheet" href="styles/app.css">
```

To preview this skin from a Mac or Windows box, append `?platform=linux` to the page URL — the
`<head>` script in `index.html` takes an explicit `?platform=` over the user agent.

## Why a placeholder, not a third kit

`win11-kit/` exists because every colour, radius, metric and timing in it was read out of
Microsoft's own MIT-licensed WinUI 3 theme resources — cited file-by-file in that kit's own
README. This kit's *colours* now have an equivalent pass: `adwaita-tokens.css`'s header cites the
exact GTK3 (not libadwaita/GTK4 — a real, visually different theme; see that file's header for why
the distinction matters) `_colors.scss` values and the SASS functions used to derive light/dark
variants from them. What's still a placeholder: radii, shadow depths, and toolbar-button hover/
press washes have no single named source in `_colors.scss` and remain hand-picked; and — the bigger
gap — this is a **static snapshot** of stock Adwaita, not the colours the user's own GTK3 theme
(Yaru, Arc, Adwaita-dark, a custom theme, …) actually resolves to.

The honest path past that gap: **read the user's own theme at runtime** instead of shipping one
fixed snapshot — GTK3 exposes the active theme's resolved colours via `Gtk.StyleContext`
(PyGObject), pushed into these same CSS custom properties from `app/linux/shell.py`
(`read_theme_colors()`) via `window.__setGtkTheme`, the same way the macOS shell already pushes the
system accent colour. This kit's sourced values are what a session gets when live reading fails
(the property doesn't exist / no GTK session at all) or hasn't answered a given token yet — see
`adwaita-tokens.css`'s header for exactly which tokens the live read can override.

## What's in the box

| File | What it provides |
|---|---|
| `adwaita-tokens.css` | `@import`s `../macos-kit/mac-tokens.css` (guaranteeing every token name resolves, including all 41 `--sf-*` icon masks, byte-identical, with zero transcription risk), then overrides accent/surface/text colours, radii, hairlines, shadows, and the "glass" specular tokens GTK has no equivalent of (set to fully transparent — see that file's own note). Everything NOT overridden — relation-category colours, layout metrics like `--arc-row`/`--grid-cell`, the mockup wallpaper — is deliberately left at macOS's tuned value. |
| `adwaita-chrome.css` | `@import`s `../macos-kit/mac-chrome.css` (already entirely token-driven, so it reskins for free once the tokens above are in effect), then hides the two things GTK chrome doesn't have (`.lights`, the scroll-edge blur ramp `.tb-blur`), gives the title bar an opaque flat background + bottom seam instead of macOS's transparent-plus-blur trick, and restates one macOS **literal** (not token) dark-mode override that the import would otherwise leak through unchanged. |

Load order matters (cascade): **`adwaita-tokens.css` before `adwaita-chrome.css`**, and both before
your app's own stylesheet, same as the other two kits.

## Icons

All 41 `--sf-*` icon masks are macOS's own, inherited verbatim through the `@import` — none were
redrawn for GNOME. `win11-kit/README.md` documents doing this deliberately for two glyphs (the
notation icons, which draw the treebank's own vocabulary rather than an OS affordance); this kit
does it for the whole set, as the placeholder shortcut it is. A real Adwaita icon pass would trade
these for GNOME's own Symbolic icon set (`Adwaita`/`hicolor` icon themes, monochrome-mask SVGs,
the same shape convention `--sf-*` already uses) — tracked as future work, not attempted here.

## No in-window menu bar or caption buttons

Unlike `win11-kit/`, this kit styles no `.capbtns`/`.menubar` hooks. Linux's menu is a **native**
`Gtk.MenuBar` (built in `app/linux/shell.py` from `app/menu_spec.py`, the same declarative table
macOS's NSMenu and Windows' in-window bar both read) and its window controls are real GTK window-
manager decorations — neither is web-drawn, so neither needs CSS here. `../macos-kit/README.md`'s
DOM-hook list otherwise still applies unchanged.
