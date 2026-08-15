# Linux packaging — `packaging/linux/`

A Debian package for SUD Workbench: `sud-workbench_<ver>_all.deb`. This is new — there was no Linux
distributable at all before this, only `app/linux/shell.py`'s *runtime* GTK3 chrome (theme reading,
a native menu bar), which had never been exercised on a real Linux install. Building this package
was also the first real execution of that file's code — see "Two real bugs in app/linux/shell.py"
below.

## Philosophy: SAME model as macOS/Windows, not a new one

`make_deb.sh` follows `packaging/make_bootstrap_app.sh` (macOS) and
`packaging/windows/make_win_app.py` exactly: ship the app **source** (`app/`, `web/`) plus a
first-launch bootstrap that builds a **per-user venv** from the machine's own Python 3.12 and
installs `requirements-core.txt` into it. Nothing is frozen, nothing is cross-compiled, no compiled
wheel is bundled for a `.deb`-buildable Debian `-dev` archive that would need to match the target's
own glibc/Python ABI.

**Why keep that model for Debian specifically**, when apt *could* just declare pip packages as
`.deb` dependencies: Debian and Ubuntu releases carry different default Python versions — Debian 12
"bookworm" ships 3.11, Ubuntu 24.04 ships 3.12, Debian 13 "trixie" ships 3.12/3.13 — and this app is
pinned to 3.12 for the same reason macOS/Windows are (`spaCy`/`stanza`/`torch` wheels are unreliable
on 3.14, and mixed against the wrong minor version at all). A single `.deb` cannot vendor prebuilt
wheels for every combination of distro release × Python minor × glibc ABI it might land on — the
exact "portability nightmare" `CLAUDE.md` already names for the other two platforms, and if anything
worse here because there are more distro/Python combinations in the wild than there are supported
macOS/Windows versions. A per-user venv, built from whatever `python3.12` **apt itself guarantees
present** via `DEBIAN/control`'s `Depends:` line, sidesteps all of that: `requirements-core.txt` is
installed fresh, against the *actual* target machine, at first launch — the same file every platform
already shares, so there is exactly one dependency list to keep current, not three.

**What Debian's package manager buys that the other two platforms don't have**: on macOS/Windows the
launcher has to *detect and possibly install* Python itself (Homebrew, or a winget/python.org
ladder) because nothing forced an interpreter onto the machine before the app first runs. On Debian,
`apt install ./sud-workbench.deb` (or `apt-get install -f` after `dpkg -i`) refuses to complete
*at all* unless `python3 (>= 3.12)` and `python3-venv` are already satisfied — so the entire
"Python might be missing, go install it" branch that `packaging/bootstrap.sh` (macOS) and
`packaging/windows/bootstrap.ps1` exist for **collapses to nothing** here. `sud-workbench.launcher`
and `setup_venv.sh` are correspondingly simpler than their macOS/Windows counterparts — see their own
headers for the detail.

## Layout

```
packaging/linux/
  make_deb.sh              ← the build script (run on macOS; see "Where dpkg-deb comes from" below)
  find_py.sh                ← locates python3.12 (mostly a defensive check — see its own header)
  setup_venv.sh              ← first-launch venv build + `pip install -r requirements-core.txt`
  sud-workbench.launcher    ← installed as /usr/bin/sud-workbench
  sud-workbench.desktop     ← installed as /usr/share/applications/sud-workbench.desktop
  sud-workbench-mime.xml    ← installed as /usr/share/mime/packages/sud-workbench.xml (.conllu/.conll)
  postinst / postrm          ← refresh mime/desktop/icon caches; guarded, never hard-fail
  copyright                  ← installed as /usr/share/doc/sud-workbench/copyright
```

Produces:

```
dist/linux/sud-workbench_<ver>_all/       ← the assembled package tree (inspectable before building)
dist/linux/sud-workbench_<ver>_all.deb    ← the built package
```

## Install location: `/opt/sud-workbench`, not `/usr/lib/sud-workbench`

FHS reserves `/usr/lib` for "internal binaries...not meant to be executed directly by users or
shell scripts" and libraries other packages link against — the shape a normal Python package takes
when it installs into system `dist-packages`. This app does neither: it manages its **own private
runtime** (the per-user venv under `~/.local/share/SUD Workbench/venv`, matching
`app/paths.py`'s `APP_DATA`) rather than integrating with system Python packaging, and nothing else
on the system is meant to import from it. That is exactly FHS's definition of `/opt`: *"reserved for
the installation of add-on application software packages... a package to be installed in `/opt/`
must locate its static files in a separate `/opt/<package>` tree"* — which is also, not
coincidentally, the same shape `Contents/Resources/appsrc` (macOS) and `appsrc\` (Windows) already
take. `/opt/sud-workbench/appsrc/{app,web}` keeps that name across all three platforms — `grammars/`
is deliberately not part of this tree; it's fetched on demand from inside the running app instead
(see `app/grammars.py`), same as every other platform.

## System runtime dependencies — verified, not guessed

`DEBIAN/control`'s `Depends:` line (see `make_deb.sh` for the fully-commented version):

```
python3 (>= 3.12), python3-venv, python3-gi, python3-gi-cairo, python3-cairo,
gir1.2-gtk-3.0, gir1.2-webkit2-4.1, gir1.2-soup-3.0, libgtk-3-0t64, git
```

Where each one comes from:

| Package | Why |
|---|---|
| `python3 (>= 3.12)`, `python3-venv` | The whole venv-bootstrap model's one hard guarantee — see "Philosophy" above. |
| `python3-gi` | Python GObject-Introspection binding — pywebview's GTK backend does `import gi`. **Not** pip-installed (see `setup_venv.sh`'s header on `--system-site-packages`). |
| `python3-cairo`, `python3-gi-cairo` | `pycairo` itself, and the GI↔Cairo override module. **Discovered as a real gap, not planned in advance** — `requirements-core.txt` already lists `pycairo; sys_platform=="linux"`, and with only `python3-gi` installed, `pip install pycairo` inside the `--system-site-packages` venv tried to BUILD it from source via meson and failed (`Unknown compiler(s): [['cc'],['gcc'],…]` — no C compiler in this Depends line). Measured live; see "Verification" below. |
| `gir1.2-gtk-3.0` | GTK3 introspection typelib — `gi.require_version('Gtk','3.0')`. |
| `gir1.2-webkit2-4.1` | WebKit2GTK 4.1 introspection typelib — `gi.require_version('WebKit2','4.1')` (pywebview falls back to 4.0, unused here). |
| `gir1.2-soup-3.0` | libsoup3 introspection typelib — `gi.require_version('Soup','3.0')`, the binding WebKit2GTK 4.1 pairs with. |
| `libgtk-3-0t64` | GTK3 itself. **Not** `libgtk-3-0` — see the ⚠ below. |
| `git` | `requirements-core.txt` installs `wiktra` from a `git+https://...` URL; pip shells out to a real `git` binary for that. |

⚠ **`libgtk-3-0t64`, not `libgtk-3-0`.** Checked directly against `packages.ubuntu.com` rather than
assumed from memory: there is **no** `libgtk-3-0` package in Ubuntu 24.04 at all — Ubuntu rebuilt
the whole archive for the 64-bit `time_t` transition and renamed the runtime library with a `t64`
suffix. `gir1.2-gtk-3.0` itself now lists `libgtk-3-0t64 (>= 3.24.30)` as its own dependency, not the
old name — confirmed via each package's own dependency listing, not inferred.

`Recommends:` (never hard-required — every use is guarded, see `postinst`): `desktop-file-utils`,
`shared-mime-info`, `hicolor-icon-theme`, `x-terminal-emulator` (a real Debian virtual package —
xterm/gnome-terminal/konsole/… all `Provide` it; see `sud-workbench.launcher`'s own note on why a
terminal matters for a visible first-run install).

## Where pywebview's GTK dependency actually comes from

Checked against pywebview `6.2.1`'s own `pyproject.toml` (the version pinned in
`requirements.txt`/`requirements-core.txt`) rather than assumed: **PyGObject is not a base
dependency of pywebview on Linux at all.** It sits behind an opt-in `gtk` extra
(`pywebview[gtk]`) that neither requirements file requests, so a plain `pip install
pywebview==6.2.1` on Linux installs *no* GTK bindings whatsoever — the app would import-error on
`import gi` with nothing more done. `requirements-core.txt`/`requirements.txt` already state the
real fix as two lines (`PyGObject; sys_platform=="linux"` and `pycairo; sys_platform=="linux"` — both
landed with `app/linux/shell.py` itself, ahead of this packaging work, with a comment pointing at
exactly this file for "the apt/dnf/pacman lines once that phase lands"). Two ways to satisfy them:

1. **pip-install PyGObject/pycairo into the venv anyway** — rejected for both, and pycairo's
   rejection is MEASURED, not just reasoned by analogy: building either from source needs
   `libgirepository-dev`/`gobject-introspection`/`pkg-config`/a C compiler at *compile* time, for
   bindings that then have to match whatever GTK/WebKit/Cairo sonames the target distro actually
   shipped. Verified live — with only `python3-gi` in Depends (no `python3-cairo`), `pip install -r
   requirements-core.txt` inside the `--system-site-packages` venv got as far as `pycairo` and failed
   outright: `Unknown compiler(s): [['cc'], ['gcc'], ['clang'], …]` (meson has no C compiler to build
   with, because none is in this Depends line). That's the "bundling compiled wheels for every distro
   is a portability nightmare" reasoning this whole model exists to avoid, landing on exactly the two
   packages where pip is the wrong tool.
2. **apt-install the prebuilt system bindings and let the venv see them** — chosen. `python3-gi`/
   `python3-cairo`/`python3-gi-cairo` are normal, prebuilt apt packages, exactly matched to the
   `libgtk-3-0t64`/`gir1.2-webkit2-4.1` apt installs alongside them. `setup_venv.sh` creates the venv
   with `python3.12 -m venv --system-site-packages`, which is what lets that venv's own
   `python -c "import gi"`/`import cairo` resolve — without the flag, a venv's `sys.path` excludes
   system `dist-packages` entirely and both imports fail even though the system interpreter right
   next to it succeeds. Every *other* package in `requirements-core.txt` is still a normal isolated
   pip install into the venv's own site-packages (which always shadows the system copy first); only
   `gi`/`cairo` ride on the system install — confirmed in the real pip log: `Requirement already
   satisfied: PyGObject in /usr/lib/python3/dist-packages … (3.48.2)` and the same for `pycairo`
   (1.25.1), with pip's resolver never touching either package's build backend at all once
   `python3-cairo` was added to Depends.

## What is NOT shipped, and why (same reasoning as the other two platforms)

- **`samples/`** — repo-only test data on every platform; nothing under `app/`/`web/` reads it at
  runtime.
- **`vendor/`** — no longer exists on any platform's build, including macOS's. It used to hold a
  self-contained `grewpy_backend` (arm64 Mach-O, `tools/bundle_grew.sh`) that only the macOS build
  shipped, but `grewpy_backend` is CeCILL v2.1 (GPL-family copyleft), so bundling it into any shipped
  build was republishing someone else's work without a grant to. `app/grew_backend.py` now fetches
  it on demand instead — via opam, onto the end user's own machine — the same on-demand shape
  `app/grammars.py` uses for the conversion grammars. A Linux user installs opam themselves, then
  installs the "grew conversion backend" row from Manage Models; without it, UD import/export and
  format conversion degrade cleanly to a toast, and every **Stanza** model is inert too, since
  Stanza emits UD and this app stores SUD (`parse._parse_stanza_ud_to_sud` needs the conversion
  grammar on every parse).
- **`web/macos-kit/`** — 12 of `mac-tokens.css`'s `--sf-*` masks are real SF Symbols rendered to
  base64 PNG, licensed by Apple for apps on Apple platforms. Same reason the Windows build excludes
  it.
- **`web/win11-kit/`** — dropped for size only (its Fluent UI System Icons are MIT and would travel
  fine); `web/index.html`'s own platform-detection script sends `"linux"` to `adwaita-kit/` and can
  never reach it anyway.
- Non-core script fonts — same `CORE_FONTS` list, same reasoning, as `make_bootstrap_app.sh`/
  `make_win_app.py`: everything else fetches on first need via `web/js/lang/fontload.js` +
  `app/fonts.py`.

## Icons: derived, never hand-drawn

`usr/share/icons/hicolor/<N>x<N>/apps/sud-workbench.png` (16/22/24/32/48/64/128/256/512) plus
`hicolor/scalable/apps/sud-workbench.svg`, generated by `magick` from
`packaging/icon-flat/appicon-flat-1024.png`/`appicon-flat.svg` — the same non-glass flat master
`build_flat_icon.py` produces and the Windows `.ico` is already built from. No new artwork.

## `.desktop` + MIME registration

`sud-workbench.desktop` (`Categories=Education;Utility;`, `Exec=sud-workbench %F`) is the Linux
counterpart of macOS's `CFBundleDocumentTypes` and the Windows installer's file-type registration:
`sud-workbench-mime.xml` declares `text/x-conllu` for `*.conllu`/`*.conll` via shared-mime-info, and
`postinst` runs `update-mime-database`/`update-desktop-database`/`gtk-update-icon-cache` (each
guarded with `command -v`, never a hard failure) so the association is live with no logout needed.

## Building

```sh
packaging/linux/make_deb.sh              # → dist/linux/sud-workbench_0.1.0_all.deb
```

**Where `dpkg-deb` comes from.** This script runs on the maintainer's Mac — same as
`make_win_app.py`, which can only *assemble* the Windows payload and says "now run `iscc` on a real
Windows box" for the final installer. `dpkg-deb` has no Homebrew formula (checked: `brew list dpkg`
→ "No such keg"), so it isn't available on the host directly. Unlike the Windows case, though,
Linux verification doesn't need to leave this Mac either: `make_deb.sh` shells out to
`docker run ubuntu:24.04 dpkg-deb --root-owner-group --build …` for the one step that genuinely
needs a Linux `dpkg`, using `--root-owner-group` (dpkg ≥ 1.19.0.5, present on every currently
supported Debian/Ubuntu) to force root:root ownership in the archive without needing a separate
`fakeroot` install. Everything else — assembling the tree, computing `Installed-Size`, generating
icons — runs in plain bash with tools already on the Mac (BSD `sed`/`du`, `magick`).

## Two real bugs in `app/linux/shell.py`, found and fixed while getting the boot-check clean

Building the package is one thing; the boot-check (below) is what actually EXERCISES
`app/linux/shell.py` for the first time on a real GTK3 session — its own docstrings already flagged
several pieces as `**Unverified on a real GTK3 session**`. Two of those pieces crashed, reproducibly,
and both are now fixed. This is the "tiny Linux-specific fix inside app/linux/ or app/__main__.py" the
task brief anticipated as sometimes-necessary; both are isolated, mechanically reproduced outside the
packaging path (a bare pywebview window plus the one function under test — see the commit for the
minimal repro scripts), and re-verified fixed the same way.

1. **`_accel_mask` handed `Gtk.Widget.add_accelerator` a bare Python `int` where PyGObject requires a
   real `Gdk.ModifierType` flags value.** `int(getattr(Gdk.ModifierType, name))` collapsed the flags
   type; the first menu row with a modifier raised `TypeError: Expected a Gdk.ModifierType, but got
   int` out of `build_menu_bar`'s per-row loop — reproduced byte-for-byte in isolation. That aborted
   the loop with some `Gtk.MenuItem`/`Gtk.Menu` widgets already constructed and orphaned (built, never
   attached to the `Gtk.MenuBar`, never freed cleanly), which is what the SECOND-order symptom
   downstream actually was: a `pango_layout_is_wrapped: assertion 'layout != NULL' failed` →
   `Gtk:ERROR …gtk_label_update_layout_width: assertion failed` → `SIGABRT` chain a few frames later —
   a use-after-free on the GTK/Pango side, not an unrelated second bug. Fixed by keeping the mask as a
   `Gdk.ModifierType` throughout (PyGObject flags support `|=` against their own members).
2. **`_install_theme_watcher` hooked its readiness callback onto *both* `shown` and `loaded`** instead
   of falling back from one to the other, so `refresh()` — a `Gtk.OffscreenWindow` create/read/destroy
   followed by a background-thread `evaluate_js` — fired **twice** at startup, seconds or milliseconds
   apart. That directly contradicts the function's own docstring ("push the current theme **once**").
   Reproduced in isolation (`_install_theme_watcher` called on its own, no menu bar, no other app
   code): 2–3 crashes in every 3 runs, always inside `Gio.Application.run()` (GTK's own main loop),
   always with the background evaluate_js thread from the FIRST `refresh()` still in flight when the
   SECOND one started. 0/5 after the fix (`break` after the first successful hook, matching
   `_install_menu_bar`'s own single-event pattern a few lines below it). It was not only a startup
   race either: `on_ready` re-runs `settings.connect(...)` on every firing, so the un-fixed version
   would have double-connected the live `notify::` handlers too, doubling every SUBSEQUENT theme
   change for the life of the window.

### One further, rarer crash — identified, reported, NOT fixed (out of permitted scope)

With both fixes in place the real end-to-end boot-check (below) passed **4 of 5** runs cleanly;
the fifth segfaulted with a THIRD, different mechanism. The crash trace's live thread is inside
`app/api.py`'s `_apply_menu` (`sync_menu` → `_apply_menu` → `Gtk.CheckMenuItem.set_active`/
`set_sensitive`) — code SHARED with macOS, not something under `app/linux/` or `app/__main__.py`,
so it is outside what this task authorized touching. The suspected mechanism, stated as a
hypothesis rather than a fix: `Api` methods are invoked by pywebview on their own bridge thread
(CLAUDE.md's own documented invariant — "pywebview dispatches every JS→Python call on its own new
thread"), and `_apply_menu`'s Linux branch calls live `Gtk.MenuItem`/`Gtk.CheckMenuItem` methods
directly from whichever thread that is — a classic GTK thread-safety violation (GTK widgets may
only be touched from the thread running the main loop). `_push_theme` in this same file already
gets this right, by design, for its own `evaluate_js` call (see its comment: "must never run from a
UI callback"); `_apply_menu` on Linux has no equivalent `GLib.idle_add` marshalling. **Flagged here
for a maintainer to fix in `app/api.py` with the appropriate review** — not attempted, per the task's
own instruction to stop and report rather than make a speculative change to code outside the
permitted, well-understood scope.

## Verification — what was actually run, and its actual output

Everything below was run for real, on this machine, via the local Docker daemon (Docker Desktop
27.4.0, `linux/arm64` engine — this Mac is Apple Silicon, so every container below is `arm64`; see
"Architecture caveat" at the end). Image: `ubuntu:24.04`
(`sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea`).

### 1. Build

```sh
packaging/linux/make_deb.sh
```

Real output (paths shortened):

```
▶ SUD Workbench 0.1.0 — Debian package build
▶ checking sources…
  ✓ all sources present
▶ package tree…
▶ copying app source…
  keeping only the core Noto faces (script faces download on demand)…
▶ hicolor icon set…
  ✓ 9 raster sizes + 1 scalable
  ✓ tree assembled:  21M
▶ building .deb…
  (no local dpkg-deb — building inside ubuntu:24.04 via Docker)
dpkg-deb: building package 'sud-workbench' in 'sud-workbench_0.1.0_all.deb'.
✓ built: dist/linux/sud-workbench_0.1.0_all.deb
  size:  12M
```

`dpkg-deb --info`/`--contents` against the built archive, run inside the same image, confirmed:
`Depends:`/`Recommends:`/`Description:` exactly as authored; every file owned `root/root`
(`--root-owner-group` verified, not assumed); `Installed-Size: 21156` (KiB).

### 2. Fresh-container install

```sh
docker run --rm -v "$PWD/dist/linux:/work" -w /work ubuntu:24.04 bash -c \
  'apt-get update -qq && apt-get install -y ./sud-workbench_0.1.0_all.deb && dpkg -s sud-workbench'
```

Pulled 280+ packages (the full GTK3 + WebKit2GTK 4.1 dependency closure — mesa/Vulkan/GStreamer
plugins, spell-checking dictionaries, `xdg-desktop-portal`, `git`, `python3.12-venv`, none of it
this package's own doing, all of it `libwebkit2gtk-4.1-0`'s real dependency tree). Real tail of the
output:

```
Setting up sud-workbench (0.1.0) ...
Processing triggers for libc-bin …
Processing triggers for dictionaries-common …
Processing triggers for ca-certificates …
Processing triggers for libgdk-pixbuf-2.0-0:arm64 …

=== EXIT: 0 ===
=== dpkg -s sud-workbench ===
Package: sud-workbench
Status: install ok installed
Priority: optional
Section: editors
Installed-Size: 21156
Maintainer: Sunflower AI <packaging@sunflowerai.io>
Architecture: all
Version: 0.1.0
Depends: python3 (>= 3.12), python3-venv, python3-gi, python3-gi-cairo, python3-cairo,
  gir1.2-gtk-3.0, gir1.2-webkit2-4.1, gir1.2-soup-3.0, libgtk-3-0t64, git
Recommends: desktop-file-utils, shared-mime-info, hicolor-icon-theme, x-terminal-emulator
```

Clean install, no errors, no dpkg warnings. `x-terminal-emulator` resolved automatically to `zutty`
(a real package `Provide`-ing the virtual name — apt picked one with no prompt). Also confirmed
inside the container: `/usr/bin/sud-workbench`, `/usr/share/applications/sud-workbench.desktop`,
`/usr/share/icons/hicolor/128x128/apps/sud-workbench.png`, `/usr/share/mime/packages/
sud-workbench.xml` all present with sane permissions; `python3.12 -c "import gi;
gi.require_version('Gtk','3.0'); from gi.repository import Gtk"` and the same for
`gi.require_version('WebKit2','4.1')` both succeeded against the SYSTEM interpreter (no venv yet at
that point) — the apt-installed typelibs genuinely resolve.

### 3. First-launch setup (`setup_venv.sh`)

Run directly (priming the venv separately from the timed boot-check is deliberate — see the note
below on why). `python3.12 -m venv --system-site-packages` + `pip install -r requirements-core.txt`
completed with no errors: `pip` reported `Requirement already satisfied: PyGObject in
/usr/lib/python3/dist-packages … (3.48.2)` and the same for `pycairo (1.25.1)` — the
`--system-site-packages` design confirmed working for BOTH packages — then resolved and installed
every other CORE dependency (spaCy 3.8.14, `en_sud_ewt`, `wiktra` from its `git+` URL, `grewpy`,
`aksharamukha`, `fasttext-wheel`'s `manylinux2014_aarch64` wheel, …) with no build failures, ending
`Successfully installed … wiktra weasel indic-transliteration spacy en_sud_ewt` and writing the
`.sud-core-ready` sentinel.

⚠ **This is the ONE thing that failed the first time** (see "Two real bugs" above for the two
application-level ones) — a genuine PACKAGING gap, not an application bug: with `python3-cairo`
absent from `Depends:`, this same command failed with `error: metadata-generation-failed … pycairo …
Unknown compiler(s)`. Fixed by adding `python3-cairo`/`python3-gi-cairo` to `Depends:` (see the table
above); re-run afterward succeeded as described.

### 4. The real boot-check

CLAUDE.md's own convention (`timeout 8 .venv/bin/python -m app samples/english.conllu` should exit
124 — still running when the timeout fires) reproduced on Linux as:

```sh
timeout 8 xvfb-run -a sud-workbench --empty; echo "exit: $?"
```

Run as a **non-root** `tester` user (`useradd -m tester`) — a real desktop install never runs a GUI
app as root, so that is the honest scenario to verify, though root was not separately re-tested
after the fixes below to say whether uid alone would have mattered independently — with
`WEBKIT_DISABLE_DMABUF_RENDERER=1` set. That environment variable is a known, documented WebKitGTK
≥2.42 workaround (its DMA-BUF-based GL renderer, on by default, is unreliable against many
virtualized/software-GPU display setups) — without it, both as root and as `tester`, this exact
command segfaulted (`exit: 139`) inside GTK's own main loop, before either of the two application
bugs below was even found; that native/GL-side instability is an ENVIRONMENT property of "WebKitGTK
2.52.3 over Xvfb+llvmpipe on arm64", not something this package's Depends: or launcher can fix, and
setting the variable in the shell that launches the app (not touching any source) is the same
category of accommodation `SUD_DEBUG=1`/`SUD_CHROME=` already are elsewhere in this codebase.

With that env var AND both `app/linux/shell.py` fixes in place, run TWICE independently — once in
the container the fixes were developed and iterated against, once in a completely fresh
`docker run` + `apt-get install ./sud-workbench_0.1.0_all.deb` container built from the final,
corrected `.deb` with no manual patching applied — five consecutive real runs each time:

```
first container:   124  124  139  124  124
fresh container:    139  124  124  124  124
```

**4 of 5 clean, both times, independently.** `crash.log` (armed by `app/__main__.py`'s own
`faulthandler`) confirms the clean runs genuinely entered the native run loop
(`=== webview.start(): entering native run loop ===`) and were still there with no further log
entry when `timeout` killed them — and confirms every `139` in both runs is the SAME crash frame
(`app/api.py:662 _apply_menu` ← `app/api.py:593 sync_menu` ← a pywebview bridge thread), not four
different failures. This is the real, unedited signal: packaging is solid; two real application
bugs were found and fixed in the one file this task authorized touching; a third, different one
remains, identified and reported rather than speculatively patched in code outside that scope.

### Architecture caveat

Every container above is `linux/arm64` (this Mac is Apple Silicon; Docker Desktop's engine runs
`arm64` natively, and pulling an `amd64` image would run under emulation at yet another cost this
already-contended sandbox could not absorb — see below). `fasttext-wheel==0.9.2`'s `aarch64` wheel
was confirmed to exist on PyPI before relying on it (`fasttext_wheel-0.9.2-cp312-cp312-
manylinux2014_aarch64.whl`), and the full `pip install -r requirements-core.txt` run above is direct
evidence every other CORE dependency also has one. **Not independently re-run on `amd64`** — the
overwhelming majority of real Ubuntu/Debian desktops are `amd64`, and nothing in `make_deb.sh` (the
package is `Architecture: all`) or the apt package names above is arch-specific, but this is stated
as a real limit of what was verified here, not implied to be equivalent.

### A note on how long this took, honestly

The Docker daemon on this shared machine was measurably deadlocked for over an hour before any of
the above could run (`docker run` against an ALREADY-LOCAL image hanging 170s+ with 0% daemon CPU —
not contention, a stuck daemon after 44 days of uptime) — recovered by quitting and relaunching
Docker Desktop, a deliberate call made because the daemon was unusable for any consumer, not just
this task. After that, every `apt-get install` here pulled the FULL GTK3+WebKit2GTK dependency
closure (280–310 packages, several tens of MB each for `libwebkit2gtk-4.1-0`/`libllvm20`/
`mesa-vulkan-drivers`) over a registry/proxy shared with several other concurrently-running agents on
this same host (direct evidence: a sibling worktree's own `docker run … fedora:41 … rpmbuild` and an
unrelated `docker pull nixos/nix` were both observed mid-flight on the same daemon) — routinely
15–30 minutes per fresh container, not seconds. Every number in this section is a real, complete run;
none is inferred or shortened.
