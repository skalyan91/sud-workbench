//@module js/ui/menubar.js
/* ─── The in-window menu bar (Windows only) ──────────────────────────────────
   macOS puts the menu in the SYSTEM bar, where AppKit owns the rows, the key equivalents and the
   show/hide of every conditional item. Windows puts it inside the window, so all of that has to be
   drawn and driven here — but NOT re-decided here. Every row comes from app/menu_spec.py over the
   bridge (Api.menu_spec), which is the same table app/__main__.py's build_menu turns into the
   NSMenu, and every row is invoked by evaluating the same `js` string the NSMenuItem hands to
   evaluate_js. So there is exactly one list of commands and one implementation of each; this file
   is a second SKIN over them, never a second copy.

   THREE THINGS THE SYSTEM MENU BAR WAS DOING FOR FREE, and where each landed:
     · key equivalents            → installAccelerators() below, driven by the same table
     · conditional show/hide      → syncMenubar(), hooked into the existing syncMenu()
     · a live Open Recent submenu → rebuilt from api.recent_files() every time the flyout opens

   Inert on macOS: every entry point returns immediately when !IS_WIN, so the file costs one
   function definition and nothing else there.

   LOAD-ORDER NOTE (see the hazard in CLAUDE.md): this module defines functions and runs NO eager
   top-level code, because it forward-references helpers defined in later-loaded modules
   (menuState in js/editing/edit-ops.js, PREFS in js/core/prefs.js, hasBridge in js/io/bridge.js).
   Boot it from js/core/init.js with bootMenubar(). */

/* Top-level order — File · Edit · Format · View · Help. Windows puts Edit second, which is the
   convention every Win32/WinUI app follows; macOS keeps its own order (Format before Edit) in
   app/menu_spec.py's MENUS. Only the SEQUENCE differs — the rows inside each menu are the same
   objects on both platforms, so the two bars cannot drift in content. */
const MENUBAR_ORDER = ["File", "Edit", "Format", "View", "Help"];

/* Alt mnemonics, assigned by ONE rule rather than by taste: the first letter of the title that no
   earlier menu has claimed. File→F, Edit→E, Format→o (F is taken), View→V, Help→H. A rule means a
   sixth menu can be added to the table without anyone having to re-audit the letters by hand. */
function mbMnemonics(titles) {
  const used = new Set(), out = {};
  titles.forEach(t => {
    for (const ch of t) {
      const c = ch.toLowerCase();
      if (/[a-z]/.test(c) && !used.has(c)) { used.add(c); out[t] = ch; return; }
    }
    out[t] = "";
  });
  return out;
}

let MENUBAR = null;        // [{title, items:[…]}] as served by Api.menu_spec()
let _mbBar = null;         // the <nav class="menubar"> host
let _mbMnem = {};          // menu title → its mnemonic character
let _mbOpen = -1;          // index of the open menu, or -1
let _mbFlyout = null;      // the open .fpmenu element
let _mbSub = null;         // the open second-level flyout (Open Recent)
let _mbRecent = [];        // last-fetched recent-file list, refreshed whenever the File menu opens
let _mbState = {};         // last menuState() push — drives visibility + checkmarks
let _mbArmed = false;      // Alt was pressed and nothing has happened since → a bare Alt focuses the bar

/* ── the row's command ───────────────────────────────────────────────────────
   Indirect eval, deliberately: `row.js` is the identical string the NSMenuItem passes to
   window.evaluate_js on macOS ("window.doOpen && doOpen()"), and running it the same way is what
   guarantees the two menus invoke the same helper rather than two hand-matched call sites. (0,eval)
   evaluates in GLOBAL scope, which is where these classic-script helpers live — a direct eval would
   run in this function's scope and resolve them anyway, but only by accident of the scope chain. */
function mbRun(row) {
  if (!row || !row.js) return;
  try { (0, eval)(row.js); }
  catch (e) { console.error("[menubar]", row.title, e); }
}

/* ── state ───────────────────────────────────────────────────────────────────
   The visibility rules are app/menu_spec.py's `visibility()`, restated in the ten lines below
   because the state never crosses the bridge on this platform — it is computed in the page by
   menuState() and would only be making a round trip to be told what it already knows. The RULE
   NAMES are the contract: a row carries `vis:"grid"`, and both sides resolve that name. Adding a
   rule means adding it in both places, which is why they are kept this short. */
function mbVisible(row) {
  if (!row.vis) return true;
  const st = _mbState || {}, has = !!st.has, zone = st.zone || "";
  switch (row.vis) {
    case "has": return has;
    case "diagram": return has && zone === "diagram";
    case "grid": return has && zone === "grid";
    default: return !!st[row.vis];   // group / merge / ungroup / convmwt / flatmwt / blockOnly / wrapOK
  }
}

function mbChecked(row) {
  if (!row.check) return false;
  // The full-screen-toolbar row is the one checkmark that is NOT in a menuState() push: the pref is
  // owned and persisted by the frontend (PREFS.fsAlwaysToolbar), and on macOS Python mirrors it off
  // disk for the same reason. Read it from where it actually lives.
  if (row.check === "fsAlwaysToolbar") return !!(typeof PREFS !== "undefined" && PREFS && PREFS.fsAlwaysToolbar);
  return !!(_mbState && _mbState[row.check]);
}

/* ── flyout construction ─────────────────────────────────────────────────────
   Reuses the .fpmenu / .fpitem / .fpsep / .fpcheck popup machinery the titlebar's own menus already
   use (js/ui/wiring.js openTbGroupMenu, js/io/bridge.js openFolderMenu) rather than inventing a
   third popup: the kit stylesheet already sizes, blurs and hover-fills those classes, so a menu
   here inherits every future change to them. `.mbmenu` is the only addition, for the kit to hang
   menu-bar-specific metrics on. */
function mbBuildFlyout(menu) {
  const m = document.createElement("div");
  m.className = "fpmenu mbmenu";
  m.setAttribute("role", "menu");
  let lastWasSep = true;   // collapse the separators that a fully-hidden conditional group leaves behind
  (menu.items || []).forEach(row => {
    if (row.sep) { lastWasSep = true; return; }
    if (!mbVisible(row)) return;
    if (lastWasSep && m.childElementCount) {
      const s = document.createElement("div"); s.className = "fpsep"; m.appendChild(s);
    }
    lastWasSep = false;
    const b = document.createElement("button");
    b.type = "button"; b.className = "fpitem"; b.setAttribute("role", "menuitem");
    const ck = document.createElement("span");
    ck.className = "fpcheck"; ck.textContent = mbChecked(row) ? "✓" : "";
    b.appendChild(ck);
    const label = document.createElement("span");
    label.className = "fplabel"; label.textContent = row.title;
    b.appendChild(label);
    const chord = mbChord(row);
    if (chord) {
      const k = document.createElement("span");
      // accel() rewrites the macOS glyph run the table stores ("⇧⌘N") into "Ctrl+Shift+N". The table
      // deliberately keeps ONE notation so this app's ~200 glyph tooltips and these labels go through
      // the one translator — see js/core/platform.js.
      k.className = "fpkbd"; k.textContent = accel(chord);
      b.appendChild(k);
    }
    if (row.submenu === "recent") {
      b.classList.add("fpsub");
      const ch = document.createElement("span"); ch.className = "fpchev"; ch.textContent = "›";
      b.appendChild(ch);
      b.addEventListener("mouseenter", () => mbOpenRecent(b));
      b.addEventListener("click", e => { e.stopPropagation(); mbOpenRecent(b); });
    } else {
      b.addEventListener("mouseenter", mbCloseSub);   // moving onto a plain row dismisses the recent flyout
      b.addEventListener("click", () => { mbClose(); mbRun(row); });
    }
    m.appendChild(b);
  });
  return m;
}

/* Open Recent, rebuilt from api.recent_files() every time it opens. The macOS side has to reach
   INTO the live NSMenu and swap the submenu's items in place (app/mac/shell.py's
   _rebuild_recent_menu_main), with a retained PyObjC target for the actions, because pywebview
   builds its menu once and offers no rebuild API. Here the flyout does not exist until it is
   opened, so "rebuild" is just "build" and none of that bookkeeping is needed. */
function mbCloseSub() { if (_mbSub) { _mbSub.remove(); _mbSub = null; } }

function mbOpenRecent(anchor) {
  mbCloseSub();
  const m = document.createElement("div");
  m.className = "fpmenu mbmenu mbsub"; m.setAttribute("role", "menu");
  const add = (label, fn, dim) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "fpitem"; b.setAttribute("role", "menuitem");
    const t = document.createElement("span"); t.className = "fplabel"; t.textContent = label;
    b.appendChild(t);
    if (dim) { b.disabled = true; b.style.opacity = ".5"; }
    else b.addEventListener("click", () => { mbClose(); fn(); });
    m.appendChild(b);
  };
  if (!_mbRecent.length) add("No Recent Files", null, true);
  _mbRecent.forEach(p => add(mbBasename(p), () => { if (window.openRecentFile) openRecentFile(p); }));
  if (_mbRecent.length) { const s = document.createElement("div"); s.className = "fpsep"; m.appendChild(s); }
  add("Clear Recent", () => { if (window.clearRecentFiles) clearRecentFiles(); });
  document.body.appendChild(m);
  _mbSub = m;
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  // Flip to the row's LEFT when there is no room on the right — the standard cascading-menu rule,
  // and the only case that matters here (the bar sits at the top-left of a window that can be
  // narrow enough for a File menu plus its submenu to reach the right edge).
  const left = (r.right + mw + 8 <= innerWidth) ? r.right - 2 : Math.max(6, r.left - mw + 2);
  m.style.left = left + "px";
  m.style.top = Math.max(6, Math.min(r.top - 4, innerHeight - mh - 8)) + "px";
}

function mbBasename(p) {
  const sep = (window.__pathInfo && window.__pathInfo.sep) || "/";
  const parts = String(p).split(sep === "\\" ? /[\\/]/ : "/");
  return parts[parts.length - 1] || String(p);
}

/* ── open / close / navigate ─────────────────────────────────────────────── */
function mbClose() {
  mbCloseSub();
  if (_mbFlyout) { _mbFlyout.remove(); _mbFlyout = null; }
  if (_mbBar) _mbBar.querySelectorAll(".mbtn.open").forEach(b => b.classList.remove("open"));
  _mbOpen = -1;
  document.removeEventListener("mousedown", mbOutside, true);
}

function mbOutside(e) {
  if (_mbFlyout && _mbFlyout.contains(e.target)) return;
  if (_mbSub && _mbSub.contains(e.target)) return;
  if (_mbBar && _mbBar.contains(e.target)) return;
  mbClose();
}

function mbOpen(i) {
  if (!MENUBAR || i < 0 || i >= MENUBAR.length) return;
  const wasOpen = _mbOpen;
  mbClose();
  if (wasOpen === i) return;   // clicking the open menu's own button closes it
  const btn = _mbBar.children[i];
  const menu = MENUBAR[i];
  // Refresh the recent list BEFORE the flyout that shows it — the fetch is async, so the flyout's
  // Open Recent row is built from the previous answer and the next open shows this one. A stale
  // first paint is the price of not blocking; the list changes only when the user opens a file.
  if ((menu.items || []).some(r => r.submenu === "recent")) mbFetchRecent();
  _mbFlyout = mbBuildFlyout(menu);
  document.body.appendChild(_mbFlyout);
  const r = btn.getBoundingClientRect(), mw = _mbFlyout.offsetWidth, mh = _mbFlyout.offsetHeight;
  _mbFlyout.style.left = Math.max(6, Math.min(r.left, innerWidth - mw - 8)) + "px";
  _mbFlyout.style.top = Math.max(6, Math.min(r.bottom + 2, innerHeight - mh - 8)) + "px";
  btn.classList.add("open");
  _mbOpen = i;
  // deferred so the mousedown that opened this menu isn't the one that closes it
  setTimeout(() => document.addEventListener("mousedown", mbOutside, true), 0);
}

function mbRows() { return _mbFlyout ? [..._mbFlyout.querySelectorAll(".fpitem:not(:disabled)")] : []; }

function mbMoveRow(d) {
  const rows = mbRows(); if (!rows.length) return;
  const cur = rows.indexOf(document.activeElement);
  const next = cur < 0 ? (d > 0 ? 0 : rows.length - 1) : (cur + d + rows.length) % rows.length;
  rows[next].focus();
}

function mbKey(e) {
  if (!IS_WIN || !MENUBAR) return;
  // Alt on its own focuses the bar (Windows' own behaviour). Armed on keydown, fired on keyUP so a
  // real chord (Alt+F, or any Alt shortcut the app owns) cancels the arming instead of also
  // stealing focus. Alt+letter opens that menu directly.
  if (e.type === "keydown" && e.key === "Alt" && !e.ctrlKey && !e.shiftKey) { _mbArmed = true; return; }
  if (e.type === "keyup") {
    if (e.key === "Alt" && _mbArmed) {
      _mbArmed = false; e.preventDefault();
      if (_mbOpen >= 0) mbClose(); else if (_mbBar && _mbBar.children.length) _mbBar.children[0].focus();
    }
    return;
  }
  _mbArmed = false;
  if (e.altKey && !e.ctrlKey && e.key && e.key.length === 1) {
    const i = MENUBAR.findIndex(m => (_mbMnem[m.title] || "").toLowerCase() === e.key.toLowerCase());
    if (i >= 0) { e.preventDefault(); mbOpen(i); mbMoveRow(1); return; }
  }
  if (_mbOpen < 0) return;   // everything below only applies while a menu is down
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); const b = _mbBar.children[_mbOpen]; mbClose(); b.focus(); return; }
  if (e.key === "ArrowDown") { e.preventDefault(); mbMoveRow(1); return; }
  if (e.key === "ArrowUp") { e.preventDefault(); mbMoveRow(-1); return; }
  if (e.key === "ArrowRight") { e.preventDefault(); mbOpen((_mbOpen + 1) % MENUBAR.length); mbMoveRow(1); return; }
  if (e.key === "ArrowLeft") { e.preventDefault(); mbOpen((_mbOpen - 1 + MENUBAR.length) % MENUBAR.length); mbMoveRow(1); return; }
}

/* ── accelerators ────────────────────────────────────────────────────────────
   On macOS AppKit matches every ⌘-chord against the menu itself, so the app needed almost no
   keyboard code. There is no menu here to do that, so this dispatcher stands in for it — from the
   SAME table, so a shortcut and its menu label can never disagree.

   Three details are copied from AppKit's own behaviour rather than invented:
     · a HIDDEN item's key equivalent does not fire, so a row whose `vis` rule is false is skipped
       (that is what makes ⌥⌘↑ mean "insert token above" with a token selected and "insert sentence
       above" with only a block selected — the two rows share the chord and are mutually exclusive);
     · the FIRST eligible row in menu order wins;
     · modifiers must match exactly, so ⌘I doesn't also fire on ⇧⌘I.
   Bubble phase and a `defaultPrevented` check keep it strictly a fallback: any module that already
   handles a chord (js/grid/columns.js owns several) runs first and this stays out of its way. */
/* The chord this row answers to HERE. `win_accel` is a per-item Windows override, present on the
   six MOVE-arrow rows only: macOS names four modifiers and Windows three, so ⌃⌘ and ⌥⌘ both map to
   Ctrl+Alt and the ⌃⌘/⌥⌘ arrow PAIRS (Move Token ↔ Insert Token, Move Sentence ↔ Insert Sentence)
   would otherwise arrive here as one chord and both fire. app/menu_spec.py carries the override in
   the SAME glyph notation, so this one accessor serves both the printed label and the keystroke
   match below — which is what makes it impossible for the label to lie about the keystroke. */
function mbChord(row) { return row.win_accel || row.accel || ""; }

function mbAccelMatch(row, e) {
  const mods = mbChord(row);
  if (!mods) return false;
  const wantCtrl = mods.includes("⌘"), wantAlt = mods.includes("⌥") || mods.includes("⌃"), wantShift = mods.includes("⇧");
  if (!!e.ctrlKey !== wantCtrl || !!e.altKey !== wantAlt || !!e.shiftKey !== wantShift) return false;
  const key = mods.replace(/[⌃⌥⇧⌘]/gu, "");
  const named = { "←": "ArrowLeft", "→": "ArrowRight", "↑": "ArrowUp", "↓": "ArrowDown", "⌫": "Backspace" }[key];
  if (named) return e.key === named;
  // ⌘+ (Zoom In) is unpressable as written on a Windows layout — "+" needs Shift, and the chord in
  // the table has none — so accept the unshifted key on the same physical cap, which is the
  // convention every browser and editor uses for zoom.
  if (key === "+" && (e.key === "=" || e.key === "+")) return true;
  return e.key.toLowerCase() === key.toLowerCase() || e.code === "Key" + key.toUpperCase();
}

function mbAccelerators(e) {
  if (!IS_WIN || !MENUBAR || e.defaultPrevented) return;
  if (!(e.ctrlKey || e.altKey)) return;                       // every accelerator in the table has ⌘ or ⌃/⌥
  const ae = document.activeElement;
  if (ae && (/INPUT|SELECT|TEXTAREA/.test(ae.tagName) || ae.isContentEditable)) return;   // typing wins
  for (const menu of MENUBAR) {
    for (const row of (menu.items || [])) {
      if (row.sep || !row.js || !mbVisible(row)) continue;
      if (mbAccelMatch(row, e)) { e.preventDefault(); mbClose(); mbRun(row); return; }
    }
  }
}

/* ── state sync (the counterpart of Api._apply_menu) ──────────────────────── */
function syncMenubar(st) {
  if (!IS_WIN) return;
  _mbState = st || {};
  if (_mbOpen >= 0) {   // a menu is down while the selection changes (⌘-arrow with the menu open) → redraw it
    const i = _mbOpen; mbClose(); mbOpen(i);
  }
}

function mbFetchRecent() {
  if (!hasBridge()) return;
  try {
    Promise.resolve(window.pywebview.api.recent_files())
      .then(list => { _mbRecent = Array.isArray(list) ? list : []; })
      .catch(() => {});
  } catch (e) { /* bridge not up yet — the next open retries */ }
}

/* ── boot ─────────────────────────────────────────────────────────────────── */
function mbRender(menus) {
  MENUBAR = MENUBAR_ORDER
    .map(t => (menus || []).find(m => m.title === t))
    .filter(Boolean);
  _mbMnem = mbMnemonics(MENUBAR.map(m => m.title));
  _mbBar.innerHTML = "";
  MENUBAR.forEach((menu, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "mbtn"; b.setAttribute("role", "menuitem");
    const mn = _mbMnem[menu.title] || "";
    const at = menu.title.indexOf(mn);
    if (mn && at >= 0) {
      b.append(menu.title.slice(0, at));
      const u = document.createElement("u"); u.textContent = mn; b.appendChild(u);
      b.append(menu.title.slice(at + 1));
    } else b.textContent = menu.title;
    b.addEventListener("mousedown", e => { e.preventDefault(); mbOpen(i); });
    // Once one menu is down, sliding along the bar switches menus without a second click — the
    // behaviour of every native menu bar, and the reason the handler is on mouseENTER rather than
    // on click.
    b.addEventListener("mouseenter", () => { if (_mbOpen >= 0 && _mbOpen !== i) mbOpen(i); });
    _mbBar.appendChild(b);
  });
}

/* THE ENTRY POINT. Call once from js/core/init.js. Safe to call on macOS (returns immediately) and
   safe to call twice (the bar is created once and re-rendered). */
function bootMenubar() {
  if (!IS_WIN) return;   // macOS has a real NSMenu; this whole module stays dormant
  // Use a #menubar the page already provides if there is one, so the title-bar layout can decide
  // where the strip sits; otherwise create it and put it after the filename block, which is where
  // Windows puts a menu bar (leading edge, below/beside the title).
  _mbBar = document.getElementById("menubar");
  if (!_mbBar) {
    _mbBar = document.createElement("nav");
    _mbBar.id = "menubar"; _mbBar.className = "menubar";
    _mbBar.setAttribute("role", "menubar"); _mbBar.setAttribute("aria-label", "Main menu");
    const tb = document.querySelector(".titlebar");
    const after = tb && (tb.querySelector(".tbfile") || tb.querySelector(".lights"));
    if (after && after.parentNode) after.parentNode.insertBefore(_mbBar, after.nextSibling);
    else if (tb) tb.appendChild(_mbBar);
    else document.body.appendChild(_mbBar);
  }
  // Guarded because this function is MEANT to be called twice — once at load, so the bar exists
  // before first paint, and again on `pywebviewready`, when there is finally a bridge to fetch the
  // real table from. A second registration would double every keystroke: Alt+F would open the menu
  // and then close it again.
  if (!window.__menubarBooted) {
    window.__menubarBooted = true;
    addEventListener("keydown", mbKey, true);       // capture: Escape/arrows must beat the document-level handlers while a menu is down
    addEventListener("keyup", mbKey, true);
    addEventListener("keydown", mbAccelerators);    // bubble + defaultPrevented: strictly a fallback (see above)
    addEventListener("blur", () => mbClose());      // the window losing focus dismisses the menu, as a native one does
  }

  /* THE ONE HOOK INTO EXISTING CODE. syncMenu() (js/editing/edit-ops.js) already fires at every
     moment the menu state can change, and it publishes itself as window.syncMenu. A classic
     script's top-level `function syncMenu` IS a property of the global object, so reassigning
     window.syncMenu replaces the binding every caller resolves — which lets the menu bar hear every
     push without a single edit to the twenty call sites. The original is still called, so the
     macOS bridge path is untouched; and menuState() is read here rather than taken from the bridge
     call because syncMenu returns early when there is no bridge, and the bar must still work in
     browser design mode. */
  if (typeof syncMenu === "function" && !window.__menubarHooked) {
    const orig = syncMenu;
    window.syncMenu = function (force) {
      try { if (typeof menuState === "function") syncMenubar(menuState()); } catch (e) {}
      return orig.apply(this, arguments);
    };
    window.__menubarHooked = true;
  }
  // "New Window" needs a second PROCESS, which only Python can spawn. The table's js string for
  // that row is `window.__newWindow && __newWindow()`, so defining it here is all the wiring the
  // row needs — and the macOS menu keeps calling _spawn_new_window directly, as it always has.
  if (typeof window.__newWindow !== "function") {
    window.__newWindow = function () { if (hasBridge()) try { window.pywebview.api.new_window(); } catch (e) {} };
  }
  // No __newTab twin: this app doesn't offer macOS window tabbing (see app/__main__.py's
  // module-level note) — every additional document opens as an ordinary window.
  // Caption buttons: the web layer draws .capbtn, Python owns the window. Guarded so the title-bar
  // module can define its own without a load-order fight — either definition calls the same bridge.
  if (typeof window.__caption !== "function") {
    window.__caption = function (what) { if (hasBridge()) try { window.pywebview.api.caption(String(what)); } catch (e) {} };
  }

  if (!hasBridge()) {
    // Browser design mode (index.html?platform=win on a Mac). There is no table to fetch — it lives
    // in Python — so render the bar's SHAPE with one explanatory row, rather than a hand-copy of 78
    // commands that would be exactly the drift app/menu_spec.py exists to prevent.
    mbRender(MENUBAR_ORDER.map(t => ({ title: t, items: [{ title: "Menu unavailable in design mode", js: "" }] })));
    return;
  }
  mbFetchRecent();
  try {
    Promise.resolve(window.pywebview.api.menu_spec())
      .then(res => mbRender((res && res.menus) || []))
      .catch(e => console.error("[menubar] menu_spec", e));
  } catch (e) { console.error("[menubar] menu_spec", e); }
}

window.bootMenubar = bootMenubar;   // the shell and init.js reach the frontend through window.*
window.syncMenubar = syncMenubar;
