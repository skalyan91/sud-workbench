# Packaging, releases, and the untested Windows track

`packaging/` — the macOS/Windows/Linux/Nix builds, the Homebrew tap a release must also reach, and an honest inventory of what has never run on Windows.

> Every ⚠ below records the diagnosis of a real bug, a measurement, or an
> alternative that was tried and rejected. Preserve that rationale when you edit
> this code — extend a note rather than re-deriving it. See `../../CLAUDE.md`.

- **`make_bootstrap_app.sh`** — the canonical build (and what the Stop hook runs). Ships the app
  *source* plus a launcher; on first launch it builds a per-user venv from the user's **own**
  Python 3.12, because a Python linked against the current macOS SDK is what gets the native Tahoe
  chrome. CORE deps only.
  ⚠ **`find_py.sh` RANKS candidates by that SDK; it no longer takes the first one that runs.** The app
  runs *inside* the chosen interpreter, so AppKit reads the interpreter's own `LC_BUILD_VERSION` and
  holds an older-SDK binary at the previous appearance — visibly, at the window edge, where a
  pre-Tahoe corner radius sits beside fully-rounded native windows. That is the "not seeing
  fully-rounded corners" report: the old order preferred Homebrew (SDK-current) but fell through to a
  python.org framework build, which targets a deliberately old SDK. `_py_sdk_major` reads it with
  `otool`; the first candidate at or beyond the running OS wins immediately (so the Homebrew case
  still costs one `otool` call), otherwise the newest-SDK candidate does. A preference, never a
  requirement — every candidate runs the app, and with no `otool` all score 0 and the list order
  decides exactly as before.
- **`make_portable.sh`** — self-contained bundle with a relocatable standalone CPython 3.12 + CORE
  deps (~300–450 MB). No external venv needed, but the older SDK costs some native chrome.
- **`make_app.sh`** — thin launcher bundle that runs this project's `.venv`; dev convenience only.
- **`build_icons.sh`** — regenerates `AppIcon.icns` + `app/data/appicon.png` from
  `packaging/AppIcon.icon` (Icon Composer). Icon Composer exports full-bleed; the script applies the
  824-in-1024 macOS grid. Also drives `build_flat_icon.py`, whose flat masters feed **both** the
  Windows `.ico` and any future non-Apple platform.
- **`packaging/windows/make_win_app.py`** — the Windows counterpart to `make_bootstrap_app.sh`, same
  architecture (ship source + launcher, per-user venv from the user's own Python 3.12 on first
  launch, CORE deps only, heavy tiers on demand). Written in **Python, not PowerShell**, so it can be
  read and `--dry-run`'d from macOS. **A real, non-`--dry-run` build has now been run from this
  machine** — `python3 packaging/windows/make_win_app.py dist` against the tree at `8aa18f5`, no
  drift found (all 14 required sources + 4 core fonts present, the dev-fixture-strip assertion still
  holds): 20–21 file operations, a 166-file/20.7 MB payload staged at `dist/win/SUD Workbench/`, and
  — see "Windows: what has never executed" below — a genuinely cross-compiled `.exe` rather than the
  `.vbs` fallback. That exercises every line in the script except the two things only a Windows
  machine can supply: winget/python.org actually installing something, and `iscc` actually compiling
  the installer (still open). `find_py.ps1`/`find_git.ps1`/`setup_venv.ps1`/`bootstrap.ps1` are the
  first-launch scripts, now parse-checked (not run) with a real `pwsh` — see below;
  `sud-workbench.iss` is the Inno Setup installer (per-user, unsigned), still never compiled.

⚠️ **A RELEASE IS NOT FINISHED WHEN THE TAG IS PUSHED — THE HOMEBREW TAP IS A SEPARATE REPOSITORY.**
macOS users install from `skalyan91/homebrew-sud-workbench`, which holds a **Formula** (not a Cask, on
purpose: the app is unsigned, so a Cask would hand Gatekeeper a quarantined prebuilt binary, while a
Formula builds from source on the installing machine and never picks up `com.apple.quarantine`). That
formula pins the version by URL — `url ".../archive/refs/tags/vX.Y.Z.tar.gz"` plus that tarball's
`sha256` — and publishing a release here touches neither, so `brew upgrade` goes on comparing the
installed version against a formula still naming the previous tag and correctly does nothing.
`.github/workflows/bump-homebrew-tap.yml` now rewrites those two lines on every `release: published`
(and by hand via `workflow_dispatch` with a tag); it needs a repository secret **`HOMEBREW_TAP_TOKEN`**
— a fine-grained PAT with Contents: write on the tap — because the default `GITHUB_TOKEN` cannot push
to another repository. It fails loudly without one, which is the right failure: a release that
silently never reached Homebrew users is what it exists to prevent.

⚠️ **The four release assets are built by hand, and one of the scripts will eat the others.**
`packaging/linux/make_rpm.sh` opens with `rm -rf "$OUT_DIR"`, so pointing it at the shared `dist/`
deletes the `.deb`, the Windows payload and the macOS bundle already sitting there — give each build
its own output directory, or run the RPM first. `make_deb.sh` additionally needs an ABSOLUTE output
path: it passes `$OUT_DIR` straight to `docker run -v`, and a relative one is refused as an invalid
volume name. Both Linux packages need Docker (`ubuntu:24.04` / `fedora:41`).

⚠️ **Each bundle ships only its own chrome kit**, and every build fails if another platform's
survives. For macOS dropping `win11-kit/` is a size decision. For Windows *and Linux* dropping
`macos-kit/` is a **licensing** one: eight of `mac-tokens.css`'s `--sf-*` masks are real SF Symbols
(rendered at packaging time now, not committed — see `app/mac/sf_symbols.py`), and Apple licenses
those for apps on *Apple* platforms. The Fluent kit supplies all 41 masks from MIT sources on
Windows, so nothing is lost there. See `THIRD-PARTY-NOTICES.md`.

⚠️ **AND `xx_sud_generic` MAY NEVER ENTER A BUNDLE**, for the same class of reason and a stricter one.
`make_portable.sh` pip-installs the model wheels it distributes straight into the app it ships, so a
wheel's licence becomes the bundle's. The generic parser — the pipeline every CUSTOM model in the app
is one embedding row of (`app/generic_models.py`) — is **CC BY-NC-SA 4.0**: 24 of its 80 training
treebanks are NonCommercial, 276 891 of 880 919 training tokens, and no relabelling of the wheel
changes what the training data permits. That is exactly the term the bundled English parser was chosen
to avoid: `en_sud_ewt_gum` is CC BY-SA only because GUM's five NonCommercial genres are excluded from
it upstream (see `THIRD-PARTY-NOTICES.md`). So the generic wheel is **fetched on demand onto the
user's own machine**, from the Add-custom-model sheet, alongside the grew backend, the `.grs`
grammars, Morpheus and the vidyut kosha. `models_registry.GENERIC_SUD` keeps it out of every
language listing; nothing in `packaging/` references it, and nothing should.

⚠️ **RESOLVED: `web/adwaita-kit/`'s two stylesheets used to `@import url("../macos-kit/…")` wholesale**
— which is exactly the directory `make_deb.sh`/`make_rpm.sh` strip for the licensing reason above.
Confirmed by extracting a real built `.deb` (found during this session, before the fix): `macos-kit/`
was genuinely absent, and `adwaita-kit/adwaita-tokens.css`/`adwaita-chrome.css` still contained
those two `@import` lines unchanged. A failed CSS `@import` degrades silently (no thrown error, just
zero rules contributed) — the 5/5 `xvfb-run` boot-checks below only confirm the *process* launches
without crashing, not that the page renders styled, so this gap went uncaught until an actual
extracted-`.deb` file check found it. **Fix:** `web/chrome-shared/` — everything `macos-kit/mac-
tokens.css`/`mac-chrome.css` used to declare directly, minus the eight real SF Symbols (which get
Fluent equivalents there instead, same MIT source `win11-kit/` uses), living somewhere no platform's
build strips. `macos-kit/` itself now just `@import`s that shared base then layers the real SF
Symbols on top; `adwaita-kit/` imports the same shared base directly. See `web/chrome-shared/
README.md` for the full account.

⚠️ **`wiktra` is a `git+` requirement and it is in `requirements-core.txt`** — so a first launch on
a machine without git fails inside pip. macOS almost always has git; Windows never does out of the
box, which is why `find_git.ps1` exists. It derives the need by *parsing* the requirements files, so
rewriting those URLs as archive URLs would switch the check off by itself.

## Linux (`.deb`, `.rpm`) and Nix — all three real, built and verified via Docker on this machine

Same architecture as macOS/Windows for the two distro packages — ship source, bootstrap a per-user
venv from the target machine's own `python3.12` on first launch, CORE deps only — deliberately
**not** used for the Nix flake, whose whole point is a hermetic build with every dependency, Python
included, resolved by Nix itself.

- **`packaging/linux/make_deb.sh`** + **`README.md`** — built and verified with real `dpkg-deb`/
  `apt install` inside fresh `ubuntu:24.04` containers. Found and fixed two real crash bugs in
  `app/linux/shell.py` (a double-hooked GTK theme-watcher event, a `Gdk.ModifierType` collapsed to a
  bare `int`) and the documented WebKitGTK ≥2.42 headless-rendering fix
  (`WEBKIT_DISABLE_DMABUF_RENDERER=1`). See that README for the full account, including the one
  known-and-not-fixed issue (an intermittent `app/api.py` `_apply_menu` GTK thread-safety crash,
  shared with macOS, out of packaging's remit).
- **`packaging/linux/make_rpm.sh`** + **`sud-workbench.spec`** + **`README-rpm.md`** — built and
  verified with real `rpmbuild`/`dnf install` inside fresh `fedora:41` containers, 5/5 clean
  `timeout 8 xvfb-run -a sud-workbench --empty` boot-checks. Reuses the `.deb` worktree's two
  `shell.py` fixes; its own distinct finding is that Fedora 41's default `python3` is 3.13 with no
  `python3.12`-targeted PyGObject build at all, so `--system-site-packages` cannot see `gi` — the
  spec instead declares the C-toolchain `Requires:` (`python3.12-devel`, `gcc`,
  `gobject-introspection-devel`, `cairo-gobject-devel`, `pkgconf-pkg-config`) and lets PyGObject/
  pycairo compile from source against the pinned interpreter at first launch. See that README for
  the full four-bug account and the file-naming reconciliation against the `.deb` build (three
  filenames collided with genuinely different content; the RPM's own copies are `find_py-rpm.sh`/
  `setup_venv-rpm.sh` at the repo level, installed at the ordinary runtime paths).
- **`flake.nix`** — a hermetic `python312Packages.buildPythonApplication`, Linux/NixOS-only,
  CORE-only, with nixpkgs pinned to a revision matching `spacy==3.8.14` and 14 PyPI wheels
  hand-packaged as Nix derivations (`wiktra` via `fetchgit`). `nix build .#default -L` verified to
  exit 0 for real inside the official `nixos/nix` container. Unlike the two distro packages this
  does **not** use the venv-bootstrap model — everything is resolved and built by Nix at
  package-build time, which is the point of packaging it this way at all.
  ⚠ **`py.pip` IS IN THE CLOSURE ON PURPOSE, AND WITHOUT IT NO MODEL COULD EVER BE DOWNLOADED.**
  "Hermetic" is a claim about standing the app UP, not a ban on pip: `models_registry.download`
  shells out to `sys.executable -m pip install --target EXTRAS_DIR` for every model wheel, and
  nixpkgs builds CPython `--without-ensurepip`, so the answer was `No module named pip` and the
  only model a Nix install could ever parse with was the one in its own closure. It has to be in
  the SAME python environment — `wrapPythonPrograms` puts `propagatedBuildInputs` on the
  launcher's `PYTHONPATH`, which a separate `python312Packages.pip` in a `nix shell` does not do
  (two store paths, only `bin/` merged). `runtimeTools` is its own list beside `coreDeps` because
  nothing in `app/` imports it. Verified end-to-end in a `nixos/nix` container (aarch64-linux):
  `nix build .#default -L` exit 0, `python3.12-pip` a DIRECT reference of the built package (so the
  wrapper's `PYTHONPATH` carries it), then a real `download("sud:sa_sud_vedic_ufal_dcs")` — wheel
  installed, its declared `indic-transliteration`/`vidyut` installed after it, the 32 MB lexicon
  fetched by the new tier, `VIDYUT_DATA` exported — and a correct parse out the other end
  (`kaṇṭhaḥ` Nom → `subj`).
  ⚠️ **And a prebuilt manylinux wheel loads there as-is** — measured, against the folklore: `pip
  install --target` of `vidyut` then `vidyut.lipi.transliterate` answers correctly with no
  `LD_LIBRARY_PATH` prefix, no `nix-ld`, no `autoPatchelf`. Its `DT_NEEDED` is glibc-family plus
  `libgcc_s.so.1`, all already mapped into the process by the closure's own CPython, so they
  resolve by soname rather than by searching a path. A wheel needing a genuinely foreign library
  (torch's CUDA stack) is a different question this does not answer.
  ⚠️ **The one download that still cannot take effect there is the BUNDLED model**, and it now says
  so rather than relaying a permission error: `_immutable_dist_dir` asks whether the shadowing copy's
  directory is WRITABLE (so a read-only bundle or a root-owned site-packages answers the same as a
  Nix store, which a `/nix/store` path test would not), and `download` reports that the package must
  be updated instead. The wheel itself installed fine; it simply cannot win `sys.path` against an
  immutable copy ahead of it.

## Windows: what has never executed

The Windows track was written from Microsoft's own MIT-licensed sources, and **no part of it has run
ON WINDOWS** — that header claim still stands and is the one that matters. What one verification
session changed is two of the sub-claims this section used to make about the macOS build box itself
("no mingw-w64/zig on this machine", "no `pwsh` here, so not even a syntax check") — both corrected
below, in place, with the measurement that supersedes each. Everything else is exactly as unverified
as it reads, and stays that way:

- **`app/win/` entirely** — DWM attributes, and whether Mica survives WebView2 at all (pywebview
  already asks DWM for it, so a failure there is WebView2 painting over it, not a missing call;
  Microsoft closed the equivalent Tauri report "not planned"). Mica is built to **degrade to an
  opaque themed background**, the same posture the codebase takes toward the grew backend — keep it
  that way. Also `IsNonClientRegionSupportEnabled`, `window.native.Handle.ToInt32()`, caption
  buttons, the registry accent (ABGR→RGB) and theme reads, `%LOCALAPPDATA%` resolution,
  `DETACHED_PROCESS`, `explorer /select,`.
- **The menubar against real keystrokes** — it renders and dismisses correctly headless, but Alt
  focus, mnemonics under a real IME, and the accelerator dispatcher have never met Windows. **Actual
  first-launch behaviour of the setup scripts on a real machine — `winget` installs, the WinForms
  progress window under WebView2's message pump, the registry accent/theme watcher — is likewise
  still entirely unverified**; see the parse-only check below, which deliberately proves none of this.
- ⚠️ **`launcher.c` HAS now been compiled — a real cross-compile from this machine — reversing the
  specific claim this section used to make ("no mingw-w64/zig on this machine").** `brew install
  mingw-w64` put `x86_64-w64-mingw32-gcc` (14.0.0_3, with its `isl` 0.28 dependency, ~1.4 GB) on
  `PATH`, and `make_win_app.py`'s existing toolchain probe (`find_win_cc`) picked it up with **no
  code change to either file**: `x86_64-w64-mingw32-gcc launcher.c -o "SUD Workbench.exe" -mwindows
  -Os -municode -lshell32 -lshlwapi` produced a 158,511-byte binary, twice, byte-identical both times.
  `file` reports it as `PE32+ executable (GUI) x86-64, for MS Windows`;
  `x86_64-w64-mingw32-objdump -f` confirms file format `pei-x86-64`, architecture `i386:x86-64`. **What
  this does NOT verify**: whether the `.exe` actually RUNS correctly on Windows — `wWinMain` spawning
  `setup_venv.ps1`/`bootstrap.ps1` with the right quoting, `SHGetFolderPathW` resolving
  `%LOCALAPPDATA%`, the `-mwindows` no-console guarantee holding in practice, the
  `GetCommandLineW`/`CommandLineToArgvW` round-trip on a real `.conllu` path with spaces. A
  cross-compile proves the toolchain and the source compile cleanly against real `<windows.h>`
  headers; it cannot execute the binary it produces.
- ⚠️ **All four `.ps1` scripts now PARSE clean, checked with a real `pwsh` — reversing "no `pwsh`
  here, so not even a syntax check."** The plan was a `mcr.microsoft.com/powershell` Docker container;
  Docker itself turned out to be unusable this session (see the `iscc` item below), so `brew install
  powershell` was used instead — 7.6.4, pulling in `dotnet` 10.0.302 as a dependency, no Docker
  involved. `[System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens,
  [ref]$errors)` against each of `bootstrap.ps1` / `find_git.ps1` / `find_py.ps1` / `setup_venv.ps1`
  returns **zero** parse errors — 696/415/303/939 tokens, 35/5/2/18 top-level statements
  respectively. This is a SYNTAX check and nothing more, **deliberately not a run**: `Find-Py`/
  `Find-Git` call `Get-Command`/registry-adjacent APIs that behave differently on a real Windows box,
  `Start-Gui`'s `System.Windows.Forms` calls have never met WebView2's message pump, and no `winget`
  exists here to actually install anything. The marker vocabulary the launcher's fast path reads
  (`MSG`/`PROGRESS`/`DONE`) is confirmed to be well-formed PowerShell; whether it is ever actually
  *emitted* by a live run is untested.
- **`iscc` (Inno Setup) still has never run — the one artifact this session could not produce.** A
  Docker-based attempt was made as planned (`amake/innosetup`, which does publish an `arm64` image
  alongside `amd64` — confirmed via the Docker Hub API before pulling) and abandoned after it would
  not complete: `docker pull hello-world` (a few kilobytes) timed out at 60 s, and `docker system df`
  — a purely LOCAL metadata query, no network involved — timed out at 20 s. `docker ps`/`docker
  images` (no daemon I/O beyond reading local state) answered instantly throughout, which narrows the
  failure to the daemon's pull/build I/O path specifically, not the CLI, the socket, or this
  repository. That shape — trivial local queries fast, anything touching the Docker Desktop VM's own
  I/O hanging indefinitely — points at host resource contention (half a dozen other concurrent agent
  worktrees were active on this same machine at the time, per `git worktree list`) rather than at
  anything wrong with the `amake/innosetup` image, the network, or `sud-workbench.iss` itself, so the
  door stays open on a quieter machine or after a Docker Desktop restart. In its place,
  `sud-workbench.iss` was read in full against documented Inno Setup 6.3+ syntax — the
  `[Setup]`/`[Languages]`/`[Tasks]`/`[Files]`/`[Icons]`/`[Registry]`/`[Run]`/`[Code]` section shape,
  the `ArchitecturesAllowed=x64compatible` spelling 6.3 requires over the deprecated `x64`, the `#if
  LauncherKind == "exe" #else #endif` ISPP conditionals inside the `[Code]` Pascal Script functions —
  and found consistent with it. **That is inspection, not compilation**, and this session's own
  `.ps1` result is the reason not to overstate what a read-through is worth: those four scripts also
  "looked right" under inspection, and inspection is exactly what the parse-check above replaced with
  a real answer. `sud-workbench.iss` has had no equivalent replacement.
- **Fonts** — `system-ui` on Windows 11 probably resolves to plain Segoe UI, *not* Segoe UI Variable
  (Mozilla bug 1732404 is WONTFIX on exactly this), which is why the stack names the Variable faces
  explicitly. Unconfirmed in WebView2.

Two things genuinely **cannot** be reproduced in the web layer and should not be attempted there:
**Mica and background Acrylic**, which sample the desktop behind the window while `backdrop-filter`
only ever sees page content. They are the native layer's job.
