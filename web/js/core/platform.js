//@module js/core/platform.js
/* ─── Which platform's chrome are we wearing? ────────────────────────────────
   Loaded FIRST, before every other app module, and deliberately self-contained: it may not
   reference anything defined in a later-loaded file (classic scripts don't hoist across files —
   see the load-order hazard in CLAUDE.md). Everything here is plain browser API.

   It does NOT decide the platform. The inline <head> script in index.html already did, because
   the KIT STYLESHEET has to be chosen before first paint and a decision made down here would be
   far too late. This module only reads that decision back off <html data-platform>, so the look
   and the behaviour can never disagree about which platform we're on. */
const PLATFORM = document.documentElement.dataset.platform === "win" ? "win"
                : document.documentElement.dataset.platform === "linux" ? "linux" : "mac";
const IS_WIN = PLATFORM === "win";
const IS_LINUX = PLATFORM === "linux";
/* ⚠ THE RENDERING ENGINE IS A DIFFERENT QUESTION FROM PLATFORM, AND data-platform ANSWERS THE WRONG
   ONE FOR IT — on report ("don't apply [WebKit-specific fixes] in Chrome, even on a Mac"). PLATFORM/
   IS_WIN is a KIT decision (which chrome/theme to draw), fixed at load from ?platform= or a UA string,
   and it is exactly right for that job — but the KIT and the ENGINE only correlate in the two
   configurations this app actually SHIPS (macOS/Linux → WKWebView/WebKitGTK, both WebKit; Windows →
   WebView2, Chromium). Loading this SAME page in a real Chrome browser for design-mode testing still
   reports data-platform="mac" (nothing overrides the UA sniff), while the engine underneath is
   genuinely Chromium — so anything gated on IS_WIN alone (a handful of narrow WebKit-only layout
   workarounds in js/diagram/diagram-core.js, none of them look/theme decisions) fires against the wrong
   engine there. `window.chrome` is a well-established, low-ceremony presence check — truthy in every
   Chromium-family browser (real Chrome, WebView2), absent in WebKit (Safari, WKWebView, WebKitGTK) —
   and unlike data-platform it answers the question these workarounds actually need asked. Published as
   <html data-engine> for the one consumer that needs it in CSS (app.css's .fo-form align-items rule);
   every JS consumer reads IS_CHROMIUM directly. */
const IS_CHROMIUM = !!window.chrome;
document.documentElement.dataset.engine = IS_CHROMIUM ? "chromium" : "webkit";
/* Linux keyboards have no Cmd key, and GTK/GNOME apps use the same Ctrl-based convention Windows
   does — so everywhere below that asks "is this the non-mac chord", Linux reads as Windows-like
   rather than as a third case. Kept as one flag rather than threading IS_WIN||IS_LINUX through
   every call site, so a future Linux-specific accelerator convention (if GTK ever wants its own
   label style, the way Windows spells "Ctrl+Shift+Z" where macOS draws "⇧⌘Z") is a one-line change
   here instead of a grep-and-replace. */
const IS_WIN_LIKE = IS_WIN || IS_LINUX;

/* ── Accelerators ────────────────────────────────────────────────────────────
   macOS names FOUR modifiers and writes them as glyphs with no separator (⇧⌘Z); Windows (and,
   here, Linux — see IS_WIN_LIKE above) names THREE and spells them out joined by "+"
   (Ctrl+Shift+Z). The interesting one is ⌃ (macOS Control), which is a *different* modifier from
   ⌘ over there but has no distinct counterpart here — so this app's five ⌃⌘ shortcuts (⌃⌘G/L/M/
   P/R) would collapse to an unpressable "Ctrl+Ctrl+G" under the obvious ⌃→Ctrl mapping. Mapping
   ⌃→Alt instead keeps them as ordinary, pressable chords (Ctrl+Alt+G), which is also the
   convention Windows/Linux ports generally follow. `cmdAltKey` below is the handler-side half of
   that same decision — change the two together or the label will lie about the keystroke. */
const _MOD_WIN = { "⌘": "Ctrl", "⌃": "Alt", "⌥": "Alt", "⇧": "Shift" };
const _MOD_ORDER = ["Ctrl", "Alt", "Shift"];        // Windows writes them in this order whatever order the macOS glyphs were in
/* Non-modifier key glyphs. macOS prints the symbol, Windows prints the word. */
const _KEY_WIN = { "⌫": "Backspace", "⌦": "Delete", "⏎": "Enter", "↩": "Enter", "⎋": "Esc",
                   "⇥": "Tab", "␣": "Space", "←": "Left", "→": "Right", "↑": "Up", "↓": "Down" };

/* Rewrite every accelerator inside an arbitrary string, leaving the surrounding prose alone —
   these arrive as whole tooltips ("Show all annotation grids (⌃⌘G)"), not as bare key specs, so a
   whole-string parse would be wrong. On macOS this is the identity function and costs nothing. */
function accel(s) {
  if (!IS_WIN_LIKE || !s) return s;
  return String(s)
    /* A run of modifier glyphs, plus the single key character that follows it (if any). The excluded
       characters are the ones that CANNOT be the key: whitespace, "," and ")" end an accelerator inside prose
       ("Undo (⌘Z)", "⌘Z, then…"), and "-" is the hyphen of "⌘-click" — a chord written as English, where
       "Ctrl+-click" would be nonsense and "Ctrl-click" is what Windows prose says. "]" is deliberately NOT
       excluded (it was, and ⌃⌘] came out as "Ctrl+Alt]"); a "]" that really is prose punctuation only ever
       follows a key already consumed as the single key character, so it survives on its own. */
    .replace(/([⌃⌥⇧⌘]+)([^\s,)\-]?)/gu, (_m, mods, key) => {
      const out = [];
      for (const g of mods) { const n = _MOD_WIN[g]; if (n && !out.includes(n)) out.push(n); }   // dedupe: ⌃ and ⌥ both land on Alt
      out.sort((a, b) => _MOD_ORDER.indexOf(a) - _MOD_ORDER.indexOf(b));
      const k = _KEY_WIN[key] || key;
      return out.join("+") + (k ? "+" + k : "");
    })
    /* A PAIR sharing one modifier run — "⌃⌘↑ / ↓", "⌥⌘←/→" — where the second key rides on the first's
       modifiers and so never meets the pattern above. Anchored to the chord just rewritten rather than run
       over the whole string ON PURPOSE: a bare "→" in prose ("UD → SUD", "commit → re-tokenise") is an arrow,
       not the Right-arrow key, and a global arrow map would silently turn one into "Right". */
    .replace(/((?:Ctrl|Alt|Shift)\+\S+\s*\/\s*)([←→↑↓⌫⌦⏎↩⎋⇥␣])/gu, (_m, pre, g) => pre + (_KEY_WIN[g] || g))
    // …and any standalone key glyph that wasn't attached to a modifier run ("Edit token ⏎", "Remove MWT ⌫").
    // Arrows are excluded here for the reason just given — they are ambiguous with prose, these are not.
    .replace(/[⌫⌦⏎↩⎋⇥␣]/gu, g => _KEY_WIN[g] || g);
}

/* One pass over already-rendered DOM. The app writes its shortcuts as literal glyphs in ~200
   places — static `title=` attributes in index.html plus JS-built menus and `.kbd` cells — and
   rewriting all of them at the call site would mean touching every one of those sites and hoping
   the next one added remembers. Sweeping the DOM instead means a new tooltip is localised for
   free. Idempotent (a rewritten string contains no glyphs left to match), so it is safe to call
   again on freshly-built subtrees; menus and sheets do exactly that. */
function localiseAccel(root) {
  if (!IS_WIN_LIKE) return;
  const r = root || document;
  r.querySelectorAll("[title]").forEach(el => {
    const t = el.getAttribute("title"), w = accel(t); if (w !== t) el.setAttribute("title", w); });
  r.querySelectorAll(".kbd, .fpkbd, .ctxkbd").forEach(el => {
    const t = el.textContent, w = accel(t); if (w !== t) el.textContent = w; });
}

/* ── Handler-side modifier tests ─────────────────────────────────────────────
   The command modifier is ⌘ (metaKey) on macOS and Ctrl on Windows, so a raw `e.metaKey` test
   silently does nothing on Windows. Every app shortcut goes through these two instead.
   `!e.altKey` in cmdKey is what keeps Ctrl+Alt+G from also firing the plain-Ctrl+G handler. */
function cmdKey(e) { return IS_WIN_LIKE ? (e.ctrlKey && !e.altKey) : e.metaKey; }
function cmdAltKey(e) { return IS_WIN_LIKE ? (e.ctrlKey && e.altKey) : (e.metaKey && e.ctrlKey); }
/* ⌥⌘ (the insert-token family: ⌥⌘↑/↓/←/→, ⌥⌘E, ⌥⌘F) — a DIFFERENT chord from ⌃⌘ on macOS, and cmdAltKey is
   not it (that one is ⌃⌘). ON WINDOWS THE TWO ARE THE SAME TEST, and that is not an oversight: this app uses
   five ⌘-family chords (⌘, ⇧⌘, ⌃⌘, ⌥⌘, ⌥⇧⌘) and Windows offers four (Ctrl, Ctrl+Shift, Ctrl+Alt,
   Ctrl+Alt+Shift), so exactly one pair MUST collapse, and the label rewrite above collapses ⌃⌘/⌥⌘ onto
   Ctrl+Alt. The overlap bites on the four arrows alone — ⌃⌘↑/↓/←/→ (move a token) against ⌥⌘↑/↓/←/→ (insert
   one) — since no other letter is in both families. Only the ⌥⌘ half has an in-page handler today
   (js/grid/columns.js); if the ⌃⌘ half ever gets one, ONE of the two needs a different Windows chord, in the
   handler AND in _MOD_WIN's labels, or Ctrl+Alt+Up will fire both. */
function cmdOptKey(e) { return IS_WIN_LIKE ? (e.ctrlKey && e.altKey) : (e.metaKey && e.altKey); }

/* ── The kit's own font stacks, as a plain string ─────────────────────────────
   --ui-font / --ui-mono are CSS custom properties (macos-kit/mac-tokens.css, redeclared by the Fluent kit),
   which covers every rule in the page. Two consumers can't use a var() and need the RESOLVED family list:
   a canvas `font=` string (canvas cannot read a var() — it rejects the whole assignment; see the note on
   refreshFontStacks in js/diagram/diagram-core.js) and the <style> block generated for the Help CHILD
   WINDOW, which loads no kit stylesheet at all. LAZY and cached: never read at module-load time, and an
   empty read (a kit stylesheet that 404'd) is not cached, so the next call can still find the real value. */
let _uiFontCache = null, _uiMonoCache = null;
function _rootProp(name) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { return ""; }
}
function uiFont() { return _uiFontCache || (_uiFontCache = _rootProp("--ui-font")) || "system-ui, sans-serif"; }
function uiMono() { return _uiMonoCache || (_uiMonoCache = _rootProp("--ui-mono")) || "ui-monospace, monospace"; }

/* Pushed by app/linux/shell.py::_push_theme once at startup and again on every live GTK3 theme
   change (Gtk.Settings' notify:: signals — event-driven, see that file). Mirrors the
   __accentChanged/__setSystemTheme convention app/mac/shell.py and app/win/shell.py already use:
   an inline style on documentElement beats the kit stylesheet's own `:root` rule, so this
   overrides web/adwaita-kit/adwaita-tokens.css's sourced-but-static defaults with whatever the
   user's actual GTK3 theme resolves to, for exactly the custom properties the read answered —
   anything it didn't (a theme that doesn't define a given named colour) is left alone, so the
   kit's own sourced value keeps showing through undisturbed. */
window.__setGtkTheme = function (colors) {
  if (!colors) return;
  for (const k in colors) document.documentElement.style.setProperty(k, colors[k]);
};

window.PLATFORM = PLATFORM;   // the native shell and the child windows reach the frontend through window.*
window.accel = accel;
window.IS_LINUX = IS_LINUX;
