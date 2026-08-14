#!/usr/bin/env python3
r"""Build the WINDOWS shipping tree for SUD Workbench — the counterpart to make_bootstrap_app.sh.

Same architecture as the macOS bootstrap build, for the same reason: ship the app SOURCE (tiny) plus
a launcher, and build a per-user venv from the user's OWN Python 3.12 the first time the app runs.
On macOS the motive is the SDK the interpreter is linked against (a bundled python-build-standalone
loses the native Tahoe chrome); on Windows the motive is different but points the same way — the
WebView2 runtime and the WinForms/pythonnet backend are machine-wide components, not things a
bundle can carry, so a frozen interpreter would buy nothing while costing ~400 MB and the ability to
`pip install` the heavy tiers into the SAME environment later (app/extras.py). CORE deps only; the
Stanza/Japanese/Arabic tiers still install on demand at runtime.

WRITTEN IN PYTHON, NOT POWERSHELL, ON PURPOSE. Nobody on this project has a Windows machine, so the
build script has to be reviewable and exercisable from macOS — hence `--dry-run`, which validates
every source path, performs the dev-fixture strip IN MEMORY (assertion included), measures what each
copy would move, and prints the file operations instead of doing them.

  packaging/windows/make_win_app.py [OUTPUT_DIR] [--dry-run]      (default OUTPUT_DIR: ./dist)

Output layout (see LAYOUT_RATIONALE below):

  dist/win/
    SUD Workbench/                 ← the payload: also a working portable directory on its own
      SUD Workbench.exe            ← console-free shim (or launcher.vbs — see build_exe_launcher())
      VERSION.txt, LICENSE.txt, THIRD-PARTY-NOTICES.txt
      appsrc/{app,web}             ← same name as Contents/Resources/appsrc on macOS
      icon/appicon.ico
      setup/{requirements-core.txt,find_py.ps1,find_git.ps1,setup_venv.ps1,bootstrap.ps1}
    installer/
      sud-workbench.iss            ← copied from packaging/windows/
      launcher.isi                 ← GENERATED: tells the .iss which launcher shape was staged

Then, on a Windows box with Inno Setup 6.3+ installed:

  iscc "dist\win\installer\sud-workbench.iss"      → dist\win\SUD-Workbench-<ver>-win64-setup.exe
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(os.path.dirname(HERE))

VERSION = "0.2.0"
APP_NAME = "SUD Workbench"

# Source trees copied into appsrc/. samples/ is deliberately absent — it is repo-only test data and
# nothing under app/ or web/ reads it at runtime, exactly as on macOS.
#
# ⚠ vendor/ IS ABSENT HERE AND THE MAC BUILDS SHIP IT, and the difference is not an oversight.
# vendor/grew/bin/grewpy_backend is a Mach-O arm64 executable with a rewritten macOS dylib closure
# (tools/bundle_grew.sh); copying it into a Windows bundle would ship dead weight that
# app/convert.py would then find on PATH and fail to spawn — worse than finding nothing, which it
# already degrades from cleanly. A Windows build needs a WINDOWS grewpy_backend, which nothing in
# this repository produces yet, so until one exists this platform has no grew: UD import/export and
# format conversion stay disabled, and — the consequence that is easy to miss — every STANZA model is
# inert too, because Stanza emits UD and this app stores SUD. Manage Models says so at the top of the
# Stanza group when the backend is missing (js/io/models.js), which is the same warning a macOS user
# without one sees.
# grammars/ is NOT one of these: the UD↔SUD conversion grammars are licensing-unclear upstream
# content, so they are no longer vendored at all — fetched on demand at runtime instead, same as
# the macron data (see app/grammars.py, app/extras.py).
SRC_TREES = ("app", "web")

# Ship the CORE Noto faces only; every other script's face is fetched on first need at runtime
# (web/js/lang/fontload.js + app/fonts.py). Same list, same reason, as make_bootstrap_app.sh — the
# script faces are over nine tenths of the payload for scripts most users never open.
# nithyaranjana.otf is NOT a Noto face: it is bundled unconditionally because it isn't on Google
# Fonts, so the on-demand fetch has nothing to ask for (see web/styles/fonts.css).
# ⚠ THIS LIST HAD DRIFTED FROM make_bootstrap_app.sh/make_portable.sh's OWN — those two picked up six
# more entries (the STACKING_SCRIPTS whose fontCovers() tofu probe is unreliable: Grantha, Javanese,
# Balinese, Kawi, Zanabazar Square, and Tibetan, the last for a different reason — macOS's system
# Kailasa face substituting silently rather than a same-named rival font, see web/styles/fonts.css's
# own note) while this one never did, so a Windows build would have silently stripped all six and left
# win11-kit's own @font-face declarations pointing at files that were never shipped. Kept in step here
# rather than left to drift further, though — like everything else under packaging/windows/ — this
# path has never actually been run on Windows; see CLAUDE.md's "Windows: what has never executed".
CORE_FONTS = ("notosans.ttf", "notosans-italic.ttf", "notosansmono.ttf", "nithyaranjana.otf",
              "notosansgrantha.ttf", "notosansjavanese.ttf", "notosansbalinese.ttf",
              "notosanskawi.ttf", "notosanszanabazarsquare.ttf", "notoseriftibetan.ttf")

# The PowerShell half of the first-launch bootstrap, staged into setup/. These are the direct
# analogues of find_py.sh / setup_venv.sh / bootstrap.sh and keep the same MSG/PROGRESS/DONE marker
# vocabulary, so the two platforms' setup scripts can be read side by side. find_git.ps1 is the one
# with no macOS counterpart: `git+` requirements (wiktra here, spacy-stanza in the full set) need a
# git binary, which macOS always has and Windows never does — see that file's header.
SETUP_SCRIPTS = ("find_py.ps1", "find_git.ps1", "setup_venv.ps1", "bootstrap.ps1")

LAYOUT_RATIONALE = """\
  · one payload directory, named for the app, that IS the installed tree — so `iscc` needs a single
    recursive [Files] rule and a user who unzips it instead of installing gets a working copy;
  · appsrc/ keeps the macOS name so PYTHONPATH, the working directory and `python -m app` are
    spelled identically in both launchers and nobody has to hold two layouts in their head;
  · setup/ separates "things the first launch runs" from "things the app runs", which is also the
    boundary the installer's optional pre-warm step ([Run]) sits on;
  · installer/ is OUTSIDE the payload so the .iss and its generated .isi are not themselves shipped
    to the user's machine."""


# ────────────────────────────────────────────────────────────────────────────────────────────────
# The dev-fixture strip. Lifted from make_bootstrap_app.sh's strip_dev_fixture(), but expressed as a
# pure text transform so --dry-run can run the real thing (including the assertion) on macOS without
# writing anything. The assertion is the point: the shipped app must carry no sample sentences.
# ────────────────────────────────────────────────────────────────────────────────────────────────
_FIXTURE_COMMENT = "browser design mode only: seeds DOC"
_FIXTURE_SCRIPT = "js/dev-fixture.js"


def strip_dev_fixture_html(html: str) -> tuple[str, int]:
    """Delete the fixture's <script> tag and the two-line HTML comment above it.

    The sed in make_bootstrap_app.sh is `/browser design mode only: seeds DOC/,+1d` (the comment,
    which spans exactly two lines) plus `\\|js/dev-fixture\\.js|d` (the tag). Reproduced literally
    rather than by parsing HTML, so the two builds can never disagree about what they removed.
    """
    lines = html.splitlines(keepends=True)
    out: list[str] = []
    skip = 0
    removed = 0
    for line in lines:
        if skip:                                  # inside the `,+1` continuation of the comment match
            skip -= 1
            removed += 1
            continue
        if _FIXTURE_COMMENT in line:
            skip = 1                              # this line and the next (the comment's closing line)
            removed += 1
            continue
        if _FIXTURE_SCRIPT in line:
            removed += 1
            continue
        out.append(line)
    stripped = "".join(out)
    # Fail the build if either survived — NOT optional; this is the assertion make_bootstrap_app.sh
    # ends strip_dev_fixture() with, and the only guard against shipping the sample sentences.
    if "dev-fixture" in stripped:
        raise SystemExit("!! dev-fixture survived the strip in web/index.html — refusing to build")
    return stripped, removed


# ────────────────────────────────────────────────────────────────────────────────────────────────
# Op recorder. Every filesystem mutation goes through this so --dry-run is a faithful preview rather
# than a separate code path that can drift from the real one.
# ────────────────────────────────────────────────────────────────────────────────────────────────
def _human(n: float) -> str:   # float, not int: callers pass an int byte count, but the /= below rebinds n to a float
    for unit in ("B", "kB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n} B"


def _measure(path: str, skip=lambda p: False) -> tuple[int, int]:
    """(file count, byte total) of a tree, honouring the same skip predicate the copy will use."""
    if os.path.isfile(path):
        return 1, os.path.getsize(path)
    files = total = 0
    for root, dirs, names in os.walk(path):
        dirs[:] = [d for d in dirs if not skip(os.path.join(root, d))]
        for n in names:
            fp = os.path.join(root, n)
            if skip(fp):
                continue
            files += 1
            try:
                total += os.path.getsize(fp)
            except OSError:
                pass
    return files, total


class Build:
    def __init__(self, dry_run: bool, root: str) -> None:
        self.dry = dry_run
        self.root = root                          # printed paths are relative to this
        self.ops = 0

    def rel(self, p: str) -> str:
        try:
            r = os.path.relpath(p, self.root)
        except ValueError:                        # different drive on Windows
            return p
        # An OUTPUT_DIR outside the project (a scratch dir, a network share) relativises to a stack
        # of "../.."s that is longer and less legible than the absolute path. Print whichever is
        # actually readable.
        return p if r.startswith(os.pardir + os.sep) else r

    def _say(self, verb: str, detail: str) -> None:
        self.ops += 1
        print(f"  {verb:<9} {detail}")

    def rmtree(self, path: str) -> None:
        if not os.path.exists(path):
            return
        self._say("rmtree", self.rel(path))
        if not self.dry:
            shutil.rmtree(path)

    def mkdir(self, path: str) -> None:
        self._say("mkdir", self.rel(path))
        if not self.dry:
            os.makedirs(path, exist_ok=True)

    def copytree(self, src: str, dst: str, skip=lambda p: False) -> None:
        n, b = _measure(src, skip)
        self._say("copytree", f"{self.rel(src)}/ → {self.rel(dst)}/   ({n} files, {_human(b)})")
        if not self.dry:
            shutil.copytree(src, dst, ignore=lambda d, names: [
                x for x in names if skip(os.path.join(d, x))])

    def copy(self, src: str, dst: str) -> None:
        self._say("copy", f"{self.rel(src)} → {self.rel(dst)}   ({_human(os.path.getsize(src))})")
        if not self.dry:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)

    def write(self, path: str, text: str, note: str = "", crlf: bool = True) -> None:
        """Write a generated text file. CRLF by default — these are files a Windows user may open in
        Notepad — but crlf=False for anything that is a REWRITE of a copied source file: converting
        the line endings of one file inside appsrc/ while its 200 neighbours stay LF would be a
        gratuitous divergence from the macOS bundle, whose sed rewrites in place and changes nothing
        else."""
        blob = text.encode("utf-8")
        self._say("write", f"{self.rel(path)}   ({_human(len(blob))}){'  ' + note if note else ''}")
        if not self.dry:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\r\n" if crlf else "") as f:
                f.write(text)

    def remove(self, path: str, note: str = "") -> None:
        self._say("rm", f"{self.rel(path)}{'  ' + note if note else ''}")
        if not self.dry and os.path.exists(path):
            os.remove(path)

    def prune(self, paths: list[str], note: str, bytes_freed: int | None = None) -> None:
        """Batched removal — one log line for a whole class of files (fonts, __pycache__).

        `bytes_freed` is passed in by callers that delete files which do not exist yet in a dry run
        (they were only going to be copied there): measuring the destination would report 0 B and
        hide the very number that justifies the prune.
        """
        total = (bytes_freed if bytes_freed is not None
                 else sum(os.path.getsize(p) for p in paths if os.path.isfile(p)))
        self._say("rm", f"{len(paths)} file(s), {_human(total)}  — {note}")
        if not self.dry:
            for p in paths:
                if os.path.isdir(p):
                    shutil.rmtree(p, ignore_errors=True)
                elif os.path.exists(p):
                    os.remove(p)


# ────────────────────────────────────────────────────────────────────────────────────────────────
# Launcher selection.
#
# The launcher must start the app with NO console window: a stray cmd.exe flashing up (or worse,
# sitting behind the window for the session) is the single most recognisable tell of a Python app
# wearing a Windows costume. That rules out a .bat/.cmd outright, and `powershell -WindowStyle
# Hidden` too — the host still creates and then hides a console, which flashes.
#
# Two shapes qualify, and this script stages whichever it can actually produce:
#
#  (a) SUD Workbench.exe — launcher.c compiled for the GUI subsystem (-mwindows). BEST: a real
#      executable, so Explorer, the taskbar, "Open with", pinning, and AppUserModelID all behave
#      normally, and it can carry an embedded icon. COSTS a Windows toolchain the macOS build box
#      does not have; the script looks for a mingw-w64 cross-compiler or `zig cc`, both of which
#      cross-compile a Windows PE from macOS, so this path is reachable here as soon as either is
#      installed (`brew install mingw-w64` / `brew install zig`).
#
#  (b) launcher.vbs run by wscript.exe — the fallback, and what a macOS box produces today. wscript
#      is a GUI-subsystem host, so it genuinely never creates a console. COSTS: the shortcut target
#      is wscript.exe with the script as an argument (so the .lnk supplies the icon via
#      IconFilename, not the binary), pinning a "wscript.exe" shortcut groups less cleanly on the
#      taskbar, and VBScript is deprecated — Windows 11 24H2 turned it into a Feature-on-Demand that
#      is still installed by default, with removal announced for a future release. It is a stopgap,
#      not the destination.
#
# Both shapes run the identical three-step decision (see launcher.c / launcher.vbs), so the only
# thing that differs downstream is how the installer spells the shortcut target — which is why this
# function's result is written out as launcher.isi for the .iss to #include rather than hard-coded
# in two places.
# ────────────────────────────────────────────────────────────────────────────────────────────────
def find_win_cc() -> tuple[str, list[str]] | None:
    """A toolchain that can emit a Windows x86-64 PE from this machine, or None."""
    mingw = shutil.which("x86_64-w64-mingw32-gcc")
    if mingw:
        return mingw, []
    zig = shutil.which("zig")
    if zig:
        # zig ships its own mingw-w64 headers/CRT, so `zig cc` cross-compiles with no sysroot setup.
        return zig, ["cc", "-target", "x86_64-windows-gnu"]
    return None


def build_exe_launcher(b: Build, payload: str) -> bool:
    cc = find_win_cc()
    if cc is None:
        return False
    exe, pre = cc
    out = os.path.join(payload, f"{APP_NAME}.exe")
    cmd = [exe, *pre, os.path.join(HERE, "launcher.c"), "-o", out,
           "-mwindows",            # GUI subsystem: the process is created with no console, ever
           "-Os", "-municode",     # -municode: wWinMain + wchar_t argv, so non-ASCII paths survive
           "-lshell32", "-lshlwapi"]
    b._say("compile", f"{os.path.basename(exe)} launcher.c → {b.rel(out)}")
    if b.dry:
        print(f"             {' '.join(cmd)}")
        return True
    subprocess.run(cmd, check=True)
    return True


# ────────────────────────────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="Build the Windows payload + installer inputs.")
    ap.add_argument("out_dir", nargs="?", default=os.path.join(PROJECT, "dist"),
                    help="output directory (default: ./dist)")
    ap.add_argument("--dry-run", action="store_true",
                    help="validate and print the file operations without performing any of them "
                         "(the only way to exercise this script from macOS)")
    args = ap.parse_args()

    out_win = os.path.join(os.path.abspath(args.out_dir), "win")
    payload = os.path.join(out_win, APP_NAME)
    installer = os.path.join(out_win, "installer")
    b = Build(args.dry_run, PROJECT)

    print(f"{'DRY RUN — ' if args.dry_run else ''}Windows build of {APP_NAME} {VERSION}")
    print(f"  project : {PROJECT}")
    print(f"  output  : {b.rel(out_win)}\n")

    # ── 0. validate every source before touching anything ───────────────────────────────────────
    print("▶ checking sources…")
    required = [os.path.join(PROJECT, d) for d in SRC_TREES]
    required += [os.path.join(PROJECT, "requirements-core.txt"),
                 os.path.join(PROJECT, "LICENSE"),
                 os.path.join(PROJECT, "THIRD-PARTY-NOTICES.md"),
                 os.path.join(PROJECT, "packaging", "icon-flat", "appicon-flat.ico"),
                 os.path.join(HERE, "launcher.c"), os.path.join(HERE, "launcher.vbs"),
                 os.path.join(HERE, "sud-workbench.iss")]
    required += [os.path.join(HERE, s) for s in SETUP_SCRIPTS]
    missing = [p for p in required if not os.path.exists(p)]
    if missing:
        print("!! missing sources:", file=sys.stderr)
        for p in missing:
            print(f"     {b.rel(p)}", file=sys.stderr)
        if os.path.join(PROJECT, "packaging", "icon-flat", "appicon-flat.ico") in missing:
            print("   (run: packaging/build_flat_icon.py ico)", file=sys.stderr)
        return 1
    for f in CORE_FONTS:
        fp = os.path.join(PROJECT, "web", "fonts", f)
        if not os.path.exists(fp):
            print(f"!! core font missing from web/fonts: {f}", file=sys.stderr)
            return 1
    print(f"  ✓ {len(required)} sources + {len(CORE_FONTS)} core fonts present\n")

    # ── 1. the dev-fixture strip, computed and ASSERTED even in --dry-run ───────────────────────
    # Done here, before any copying, so a regression in web/index.html fails the build immediately
    # rather than after 50 MB of I/O — and so `--dry-run` on macOS proves the assertion still holds.
    print("▶ dev-fixture strip (assertion runs in dry-run too)…")
    index_src = os.path.join(PROJECT, "web", "index.html")
    stripped_html, removed = strip_dev_fixture_html(open(index_src, encoding="utf-8").read())
    print(f"  ✓ {removed} line(s) removed from web/index.html; no 'dev-fixture' survives\n")

    # ── 2. payload skeleton + app source ────────────────────────────────────────────────────────
    print("▶ payload…")
    b.rmtree(out_win)
    b.mkdir(payload)
    appsrc = os.path.join(payload, "appsrc")
    b.mkdir(appsrc)
    skip_pycache = lambda p: os.path.basename(p) == "__pycache__"
    # THE OTHER PLATFORM'S CHROME KIT IS NOT SHIPPED. index.html picks exactly one kit at load from
    # <html data-platform>, so macos-kit/ is dead weight in a Windows bundle — but the reason it is
    # EXCLUDED rather than merely unused is licensing: 12 of mac-tokens.css's --sf-* masks are real
    # SF Symbols rendered to base64 PNG, and Apple licenses those for use in apps on Apple platforms.
    # Reproducing them inside a Windows application is not covered. The Fluent kit carries its own
    # MIT-licensed Fluent UI System Icons for all 38, so nothing is lost. The macOS build excludes
    # win11-kit/ symmetrically (see make_bootstrap_app.sh) — there for size alone, MIT travelling fine.
    skip_win = lambda p: skip_pycache(p) or os.path.basename(p) == "macos-kit"
    for d in SRC_TREES:
        b.copytree(os.path.join(PROJECT, d), os.path.join(appsrc, d),
                   skip=skip_win if d == "web" else skip_pycache)

    # Overwrite the copied index.html with the stripped text, and delete the fixture itself. (On
    # macOS this is sed-in-place; here the transform already ran above, so it is a plain write.)
    b.write(os.path.join(appsrc, "web", "index.html"), stripped_html,
            note="← dev-fixture stripped", crlf=False)
    b.remove(os.path.join(appsrc, "web", "js", "dev-fixture.js"), note="(browser design-mode fixture)")

    if not b.dry and os.path.exists(os.path.join(appsrc, "web", "macos-kit")):
        raise SystemExit("!! macos-kit/ survived into the Windows payload — refusing to build "
                         "(it carries base64-rendered SF Symbols; see the skip_win note above)")

    fontdir = os.path.join(PROJECT, "web", "fonts")
    dropped = [f for f in sorted(os.listdir(fontdir)) if f not in CORE_FONTS]
    b.prune([os.path.join(appsrc, "web", "fonts", f) for f in dropped],
            "non-core script faces (fetched on demand at runtime)",
            bytes_freed=sum(os.path.getsize(os.path.join(fontdir, f)) for f in dropped))

    # ── 3. setup half + icon + version stamp ────────────────────────────────────────────────────
    print("\n▶ first-launch setup, icon, version…")
    b.copy(os.path.join(PROJECT, "requirements-core.txt"),
           os.path.join(payload, "setup", "requirements-core.txt"))
    for s in SETUP_SCRIPTS:
        b.copy(os.path.join(HERE, s), os.path.join(payload, "setup", s))
    b.copy(os.path.join(PROJECT, "packaging", "icon-flat", "appicon-flat.ico"),
           os.path.join(payload, "icon", "appicon.ico"))
    b.write(os.path.join(payload, "VERSION.txt"), VERSION + "\n")
    # Renamed to .txt: Inno's LicenseFile only accepts .txt or .rtf, and a Windows user who opens
    # the install directory expects a double-clickable file rather than an extensionless one.
    b.copy(os.path.join(PROJECT, "LICENSE"), os.path.join(payload, "LICENSE.txt"))
    b.copy(os.path.join(PROJECT, "THIRD-PARTY-NOTICES.md"),
           os.path.join(payload, "THIRD-PARTY-NOTICES.txt"))

    # ── 4. launcher ─────────────────────────────────────────────────────────────────────────────
    print("\n▶ launcher (console-free)…")
    if build_exe_launcher(b, payload):
        launcher_kind = "exe"
        print("  ✓ native GUI-subsystem .exe")
    else:
        b.copy(os.path.join(HERE, "launcher.vbs"), os.path.join(payload, "launcher.vbs"))
        launcher_kind = "vbs"
        print("  ⚠ no Windows toolchain found (mingw-w64 / zig) — staged launcher.vbs instead.")
        print("    Still console-free (wscript.exe is a GUI-subsystem host), but see the launcher")
        print("    comment block in this script: `brew install mingw-w64` or `brew install zig`,")
        print("    then rebuild, to get the real .exe.")

    # ── 5. installer inputs ─────────────────────────────────────────────────────────────────────
    print("\n▶ installer inputs…")
    b.copy(os.path.join(HERE, "sud-workbench.iss"),
           os.path.join(installer, "sud-workbench.iss"))
    # Only three facts cross from the builder into the .iss, and LauncherKind is the load-bearing
    # one: the .iss's [Code] branches on it (#if) to spell the shortcut target and the .conllu open
    # command. Deliberately NOT the full command strings — an Inno parameter containing quotes needs
    # every quote doubled, and nesting that inside an ISPP string literal doubles them again, which
    # is exactly the kind of unreviewable escaping this whole build script exists to avoid.
    isi = f'''; GENERATED by packaging/windows/make_win_app.py — do not edit.
#define AppVersion "{VERSION}"
#define PayloadDir "..\\{APP_NAME}"
#define LauncherKind "{launcher_kind}"
'''
    b.write(os.path.join(installer, "launcher.isi"), isi)

    # ── done ────────────────────────────────────────────────────────────────────────────────────
    n, total = (0, 0) if args.dry_run else _measure(payload)
    print(f"\n{'Would perform' if args.dry_run else 'Performed'} {b.ops} file operation(s).")
    if not args.dry_run:
        print(f"✓ payload: {b.rel(payload)}   ({n} files, {_human(total)})")
    print("\nLayout rationale:")
    print(LAYOUT_RATIONALE)
    print("\nNext (on Windows, Inno Setup 6.3+):")
    print(f'  iscc "{b.rel(installer)}\\sud-workbench.iss"'.replace("/", "\\"))
    print(f"  → {b.rel(out_win)}\\SUD-Workbench-{VERSION}-win64-setup.exe".replace("/", "\\"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
