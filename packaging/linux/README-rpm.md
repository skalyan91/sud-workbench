# RPM packaging (`packaging/linux/`)

This is the RPM-based-distro counterpart of `packaging/make_bootstrap_app.sh` (macOS) and
`packaging/windows/make_win_app.py` (Windows) — see this repo's root `CLAUDE.md` for the
architecture those two documents in full; this file only covers what's specific to the RPM build.
A sibling `.deb` build lives in the same `packaging/linux/` directory, merged into `main`
independently and slightly earlier. The two pipelines were developed in parallel worktrees with
no visibility into each other's choices, so three filenames collided (`find_py.sh`,
`setup_venv.sh`, `sud-workbench.desktop`) with genuinely different, distro-appropriate content —
the `.deb` versions kept the bare names (merged first); the RPM's own copies were renamed to
`find_py-rpm.sh`/`setup_venv-rpm.sh` at the **source** level. `sud-workbench.desktop` converged on
the `.deb`'s copy verbatim (it was the more complete of the two, carrying `MimeType=`) — there was
nothing RPM-specific in it to lose. `sud-workbench.sh` (the RPM's launcher) and
`sud-workbench.spec`/`make_rpm.sh` themselves never collided with the `.deb`'s own
`sud-workbench.launcher`/`make_deb.sh`. Note that `%install` in the spec still installs the two
renamed scripts to the plain runtime paths `/opt/sud-workbench/find_py.sh` and
`.../setup_venv.sh` — the rename is a repo/source-tree distinction only, not a runtime one.

## What's here

| File | Role |
|---|---|
| `sud-workbench.spec` | The RPM spec — package metadata, `Requires:`, `%files`, scriptlets. |
| `make_rpm.sh` | Build driver: stages the source tree, derives the icon set, then runs `rpmbuild` inside a Fedora container. |
| `find_py-rpm.sh` | Sourced by `setup_venv-rpm.sh`; locates the system's `python3.12`. Installed at runtime as `/opt/sud-workbench/find_py.sh` (see naming note above). |
| `setup_venv-rpm.sh` | First-launch bootstrap: builds the per-user venv, compiles PyGObject/pycairo into it, installs `requirements-core.txt`. Installed at runtime as `/opt/sud-workbench/setup_venv.sh`. |
| `sud-workbench.sh` | Installed as `/usr/bin/sud-workbench` — the thin launcher. |
| `sud-workbench.desktop` | `/usr/share/applications/sud-workbench.desktop` — shared verbatim with the `.deb` build. |
| `.gitignore` | Ignores `build/` — `make_rpm.sh`'s scratch output; never committed. |

## Why the venv-bootstrap model, again

Every argument `make_bootstrap_app.sh`'s header and `make_win_app.py`'s header make for macOS and
Windows applies at least as strongly to an RPM-based distro, and more so in one respect: "Linux" is
not one ABI. A binary wheel built for Fedora 41's glibc may not load on RHEL 9's older one; a
`rpmbuild` run on Fedora targets Fedora's own Python 3.12 build, which is not binary-compatible
with, say, openSUSE's. Bundling compiled wheels for every RPM-based distro this package might land
on is exactly the "portability nightmare" the task brief warns against — so this package ships
**source only** (`app/`, `web/`, `grammars/`) plus a launcher, and builds its Python environment
**on the machine that will run it**, from **that machine's own** `python3.12` package. The RPM's
`Requires:` guarantees that interpreter — and the system GTK/WebKit2GTK bindings — exist before
`sud-workbench` is ever run; first launch only has to `pip install` the pure-Python/thinc-CNN
core stack (`requirements-core.txt`), which is fast and needs no root privileges (everything that
needed root was already satisfied by `dnf install`).

## Install location: `/opt/sud-workbench`

FHS §3.9 reserves `/opt` for "the installation of add-on application software packages" — a
self-contained bundle that is not the distribution's own native packaging of a library the system
Python imports. That's exactly this package's shape: it does not integrate into the system
Python's `site-packages`; it builds and owns a **separate, per-user venv** (so N users on one
machine can each have their own installed model tiers without touching anything under `/usr`).
`/usr/lib/sud-workbench` would be the more idiomatic choice for a package that *does* extend the
system Python — this one deliberately doesn't, so `/opt/sud-workbench` names the shipped tree for
what it is. This was an independent choice, made without visibility into the sibling `.deb`
agent's decision (per the task brief); if the two end up choosing different locations, reconciling
is a one-line change to `sud-workbench.sh`'s `RES=` and the spec's `%install`/`%files` paths, not a
structural rework.

## The GTK/WebKit `Requires:` — how each name was arrived at, not guessed

`app/linux/shell.py` states plainly what pywebview's GTK backend needs: GTK3, unconditionally
(`gi.require_version('Gtk', '3.0')`), and WebKit2GTK, preferring the 4.1 API
(`gi.require_version('WebKit2', '4.1')` + `Soup 3.0`) and falling back to 4.0 + `Soup 2.4` only if
4.1's typelib is missing. That's read straight from the **pinned** `pywebview==6.2.1`'s own
`webview/platforms/gtk.py`, not from pywebview's docs, which don't spell out the fallback order at
all. Every name below was confirmed to actually resolve via a real `dnf install` inside a fresh
Fedora 41 container (not a bare `dnf search`) — see "What was verified".

Declared `Requires:` (see the spec's own inline comments for the fuller per-package reasoning):

- `python3.12` — the project's pinned interpreter; the venv is built from this exact binary.
- `python3.12-devel` — `Python.h` + the interpreter's own pkg-config file, which PyGObject's
  meson-python build needs to compile against 3.12 specifically.
- `gcc` — the C compiler PyGObject's/pycairo's source builds invoke.
- `pkgconf-pkg-config` — meson locates gtk3/gobject-introspection/cairo via `.pc` files.
- `gobject-introspection-devel` — girepository headers PyGObject's C extension links against.
- `cairo-gobject-devel` — the cairo/GObject integration headers pycairo's build needs.
- `gtk3` — pywebview's GTK3 backend + `app/linux/shell.py`'s theme reader and native menu bar.
- `webkit2gtk4.1` — the WebKit2GTK API pywebview tries first (Fedora ships the libsoup3 rebuild
  under this exact name; confirmed live — see below).
- `git` — `requirements-core.txt` pins `wiktra @ git+https://github.com/twardoch/wiktra2`, so
  first-launch `pip install` shells out to `git clone`. Confirmed missing by default and load-bearing
  live (see "What was verified"); the same class of gap `find_git.ps1` closes on Windows.
- `hicolor-icon-theme` — owns `hicolor`'s `index.theme`, so `Icon=sud-workbench` resolves by name.
- `desktop-file-utils` (`Requires(post)`/`Requires(postun)` only) — supplies
  `update-desktop-database`, called from the package's `%post`/`%postun` scriptlets.

**Not declared**: `gtk3-devel`, `webkit2gtk4.1-devel` — the pkg-config chain
`gobject-introspection-devel` pulls in plus the runtime packages above already give PyGObject's/
pycairo's builds everything they ask for; confirmed by the build actually succeeding without them.

## Why PyGObject/pycairo compile from source, against a *devel* toolchain — not `--system-site-packages`

`requirements-core.txt` carries `PyGObject; sys_platform == "linux"` and
`pycairo; sys_platform == "linux"`. Neither ships a prebuilt Linux **wheel**, so installing them
via pip always means a source build — the design question was only where the *already-built*
bindings should come from.

**The first design, measured wrong.** The original plan was to skip compiling altogether: build
the venv `--system-site-packages` and lean on Fedora's own prebuilt `python3-gobject`/
`python3-cairo`, declaring only runtime libraries in `Requires:` (no compiler, no `-devel`
packages). Live in a real Fedora 41 container this failed outright: `python3-gobject`'s files land
under `/usr/lib64/**python3.13**/site-packages/gi/`, because Fedora 41's *default* `python3` is
3.13 — and Fedora ships **no** `python3.12`-targeted PyGObject build at all
(`dnf list available 'python3.12*'` lists only the interpreter and its `-devel`/`-libs`/`-tkinter`/
`-idle`/`-debug`/`-test` siblings, nothing GObject-related). A `python3.12 -m venv
--system-site-packages` venv's system site-packages path is `.../python3.12/site-packages`, which
is empty of `gi` regardless of the flag — confirmed directly with `python3.12 -c "import gi"`
outside any venv too, same `ModuleNotFoundError`. Retargeting the venv at Fedora's default 3.13 to
dodge this would be a bigger, unverified architectural change (this project pins 3.12 everywhere
for spaCy/thinc/blis wheel availability) for a packaging script to make unilaterally.

**The fix actually shipped**: build PyGObject/pycairo for real, against the real pinned
interpreter. `setup_venv-rpm.sh` creates a plain venv (no `--system-site-packages`) and runs
`pip install -r requirements-core.txt` **unfiltered** — PyGObject and pycairo install like every
other line, and pip's build backend (meson-python for PyGObject) reaches the dev headers the
spec's `Requires:` now guarantee (`python3.12-devel`, `gcc`, `pkgconf-pkg-config`,
`gobject-introspection-devel`, `cairo-gobject-devel`). `gtk3` and `webkit2gtk4.1` stay `Requires:`
as system **libraries** (the `.so`s the compiled extension links against at import time) — only
the Python-level bindings needed to change from "assumed pre-built" to "compiled at first launch".
This costs a first-launch pip install a few minutes instead of a few seconds, but it is the
*correct* answer where the shortcut was not: confirmed live producing a working
`PyGObject-3.56.3`/`pycairo-1.29.1` inside the venv, `import gi` succeeding, and the app actually
painting (see "What was verified").

## Two real bugs in `app/linux/shell.py`, found during this task's own verification

This RPM path and the sibling `.deb` path were developed in parallel worktrees, both against
`app/linux/shell.py` (the Linux GTK3 runtime shell — theme reader, native menu bar), and both hit
the **same** segfault on first real boot in a container. The `.deb` worktree diagnosed it first, as
two independent bugs in that file, unrelated to packaging: `_install_theme_watcher` hooked both a
`shown` and a `loaded` readiness event, double-firing into a GTK main-loop segfault (fixed with a
`break` after the first hook fires); and `_accel_mask` collapsed a `Gdk.ModifierType` to a bare
Python `int`, which raised inside GTK's own event handling and produced a
`TypeError` → orphaned-widget → use-after-free → SIGABRT/SIGSEGV chain (fixed by keeping the value
as a real `Gdk.ModifierType` throughout). Both fixes are now on `main` (merged with the `.deb`
work) and are what this RPM's own verification below is built on top of — this packaging task
found the *symptom* (a segfault right after `[linux] active GTK theme: …` printed) independently,
but the root cause and fix are credited to the `.deb` worktree's diagnosis, reused verbatim here.

A separate, still-open GTK thread-safety bug (`app/api.py`'s `_apply_menu`, reached from a
pywebview bridge thread, shared code with macOS) causes an intermittent (~1-in-5) crash under load
and is **not** fixed by either packaging pipeline — it's an application bug outside packaging's
remit, documented here and in the `.deb`'s own `README.md` rather than patched.

## Building

```sh
packaging/linux/make_rpm.sh                      # → packaging/linux/build/rpmbuild/RPMS/noarch/sud-workbench-<ver>-1.<dist>.noarch.rpm
packaging/linux/make_rpm.sh --image fedora:41     # explicit (also the default)
```

Requires Docker on the build machine (used only to get a real `rpmbuild`/`dnf` toolchain — nothing
about the output `.rpm` is container-specific). The script:

1. Stages `app/`, `web/`, `grammars/` into a clean tree, applying the same trims every platform's
   build already applies — `__pycache__` stripped, the *other two* platforms' chrome kits dropped
   (`macos-kit/`, `win11-kit/` — Linux ships only `web/adwaita-kit/`), the browser design-mode
   fixture (`js/dev-fixture.js` + its `<script>` tag) stripped, `web/fonts/` trimmed to the same
   four CORE faces the macOS/Windows builds ship.
2. Tars that tree as `Source0`, derives the `hicolor` icon set from
   `packaging/icon-flat/appicon-flat-1024.png` (ImageMagick `magick -resize`, 16→512px, plus the
   flat SVG for `scalable/`) — no icon is hand-drawn.
3. Runs `rpmbuild -bb` for the staged spec **inside a Fedora container**, so the result is the
   literal thing `dnf install` will later see, not an approximation built with whatever RPM tooling
   (or lack of it) happens to be on the build machine.
4. Cross-checks `app/__init__.py`'s `__version__` against the spec's `%global app_version` before
   building anything, so the two can't silently drift apart the way two independently-hard-coded
   `VERSION = "0.1.0"` literals (the macOS/Windows builders' own approach) could.

## Why Fedora (not Rocky/Alma)

Fedora ships the current `webkit2gtk4.1` package and a recent GTK3/PyGObject stack; Rocky/Alma 9
track RHEL 9, which is several years behind on exactly the WebKitGTK API pywebview's GTK backend
prefers (4.1, the libsoup3 rebuild) — a EL9 build would very plausibly fall back to the older
WebKit2 4.0 + Soup 2.4 path, which pywebview's own source treats as the degraded case. Building and
verifying against the distro that has the *preferred* path exercises more of the real code than
building against the distro that's guaranteed to hit the fallback. Nothing here is
Fedora-*specific* in the packaging sense (the spec is a plain RPM spec, no Fedora-only macros
beyond the standard `%{?dist}`), so retargeting to EL9/Rocky/Alma later is a `--image` flag away —
the `Requires:` list would need re-verifying against EL9's own package names first (RHEL-family
naming has drifted from Fedora's before, e.g. `python3-gobject-base` vs `python3-gobject`).

## What was verified — real Docker, real install, real headless boot

Everything below is a genuine run, not an inference from the design — including a final rebuild
against `main`'s own fully-integrated checkout (the actual files this repo ships), after all the
fixes and file reconciliation this document describes.

**Build** (`packaging/linux/make_rpm.sh`, `rpmbuild -bb` inside `fedora:41`):
```
▶ building sud-workbench 0.1.0 for fedora:41
▶ staging app/ web/ grammars/ …
▶ keeping only the core Noto faces (script faces download on demand)…
▶ tarring Source0…
▶ deriving hicolor icons from packaging/icon-flat/ …
▶ rpmbuild inside fedora:41 …
✓ built: packaging/linux/build/rpmbuild/RPMS/noarch/sud-workbench-0.1.0-1.fc41.noarch.rpm
  11M
```
(An earlier version of this build produced two harmless "Macro expanded in comment" warnings here —
a `%license` mentioned in a comment, macro-expanded by rpmbuild's parser even inside a `#` line.
Cosmetic, never a build failure, and now silenced by escaping it `%%license` in the spec's own
comment.)

**Install, in a *fresh* container of the same image (not the build container)** — `dnf install`
resolved every `Requires:` (including `python3.12-devel`, `gcc`, `gobject-introspection-devel`,
`cairo-gobject-devel`, `webkit2gtk4.1`, `git`) with no missing-package errors, exit 0.

**First-launch bootstrap**, run once inside that fresh container before the timed boot-checks
(`WEBKIT_DISABLE_DMABUF_RENDERER=1 xvfb-run -a sud-workbench --empty`):
```
SUD Workbench — first-launch setup (this can take a minute or two)…
Locating Python 3.12…
Creating the environment…
Upgrading pip…
Installing dependencies (this can take a few minutes — PyGObject compiles from source; see the header note above)…
Finishing up…
Setup complete.
[linux] active GTK theme: 'Adwaita' (prefer-dark=False)
```
(The `[pywebview] Error while processing window.native.*: unable to get the value` lines that
follow are pywebview's own harmless introspection noise under Xvfb with no real GTK backing store
for those properties — present on every run, never fatal, and orthogonal to this package.)
PyGObject compiled successfully (`PyGObject-3.56.3`, `pycairo-1.29.1`), `import gi` succeeded, and
the app reached its normal startup log line — confirming the whole from-source PyGObject path
this document argues for actually works, not just that it type-checks.

**Headless boot check**, reproducing this repo's own `timeout 8 … ; exit 124` convention
(`CLAUDE.md`'s "Real boot" check), **five consecutive runs**, each a fresh process:
```
$ WEBKIT_DISABLE_DMABUF_RENDERER=1 timeout 8 xvfb-run -a sud-workbench --empty ; echo "exit: $?"
RUN 1 EXIT: 124
RUN 2 EXIT: 124
RUN 3 EXIT: 124
RUN 4 EXIT: 124
RUN 5 EXIT: 124
```
5/5 clean — the app started, stayed up for the full 8s window (i.e. was genuinely running, not
crash-looping), and was killed by `timeout` as expected. `WEBKIT_DISABLE_DMABUF_RENDERER=1` is the
documented WebKitGTK ≥2.42 fix for headless/Xvfb rendering (found by the `.deb` worktree's own
investigation, not the `WEBKIT_DISABLE_COMPOSITING_MODE`/`LIBGL_ALWAYS_SOFTWARE` flags tried and
rejected first) — it is not RPM-specific and belongs in any Linux launch script/desktop file that
expects to run under Xvfb or a GPU-less container; a real desktop session with a working DRI stack
does not need it.

This exact sequence — build, install, bootstrap, 5× boot-check — was run twice: once in the RPM
worktree during the debugging that found the four bugs below, and once more, identically, against
`main`'s own final integrated checkout (the files actually committed here), to confirm the merge
and file-renaming reconciliation didn't reintroduce anything. Both runs: 5/5 clean.

**Four real bugs found and fixed while getting here** (beyond the two `app/linux/shell.py` bugs
credited to the `.deb` worktree above):
1. macOS `tar`/`cp` embedding AppleDouble `._*` sidecar files into the source tarball, which
   `rpmbuild` then flagged as "Installed (but unpackaged) file(s)" under `/usr/share/icons/`. Fixed
   with `export COPYFILE_DISABLE=1` in `make_rpm.sh`.
2. `pip install`'s `wiktra @ git+...` dependency failing with "Cannot find command 'git'" — Fedora's
   base image has no `git`. Fixed by adding `Requires: git` (see above).
3. `ModuleNotFoundError: No module named 'gi'` from the original `--system-site-packages` design —
   see "Why PyGObject/pycairo compile from source" above for the full account.
4. The segfault right after the GTK theme log line — traced to the two `app/linux/shell.py` bugs
   the `.deb` worktree found (see above), plus needing `WEBKIT_DISABLE_DMABUF_RENDERER=1`.

**Known, not fixed** (out of packaging's remit): the intermittent `app/api.py` `_apply_menu`
thread-safety crash noted above.

## Rebuilding after a source change

Nothing here is generated from a cache that could go stale silently — `make_rpm.sh` does a
`rm -rf` of its `build/` output on every run, so a stale staged tree is not a failure mode. Bump
`%global app_version` in `sud-workbench.spec` (and `app/__init__.py`'s `__version__`, which
`make_rpm.sh` checks against it) when the app's version changes; nothing else here is
version-pinned.
