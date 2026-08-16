# RPM spec for SUD Workbench — the Linux (RPM-based-distro) counterpart of
# packaging/make_bootstrap_app.sh (macOS) and packaging/windows/make_win_app.py (Windows).
#
# SAME MODEL AS THE OTHER TWO PLATFORMS, DELIBERATELY: this package ships the app SOURCE (app/ web/,
# ~a few MB) plus a launcher and a first-launch bootstrap script. grammars/ is NOT part of that
# source tree — it's fetched on demand from inside the running app instead (see app/grammars.py),
# so this spec never sees it. It does NOT vendor a Python interpreter or any compiled wheel. On
# first run, /usr/bin/sud-workbench builds a per-user
# venv from the SYSTEM's own Python 3.12 (this package's own Requires: guarantees one exists) and
# `pip install`s requirements-core.txt into it — exactly the "build against the machine that will
# run it" reasoning make_bootstrap_app.sh's header gives for macOS, which applies at least as
# strongly here: an RPM built on Fedora 41 that also had to run on RHEL 9, openSUSE, and whatever
# glibc/Python patch level each ships would need either N separately-built packages or a vendored,
# statically-linked Python — both of which this project has already rejected for the other two
# platforms for the same reason (see make_bootstrap_app.sh's and make_win_app.py's own headers).
# `packaging/linux/make_rpm.sh` is the build driver that assembles this spec's Source files and
# invokes rpmbuild; see `packaging/linux/README-rpm.md` for the full pipeline and what was verified.
#
# INSTALL LOCATION: /opt/sud-workbench (app source, read-only, root-owned), NOT /usr/lib/sud-workbench.
# FHS §3.9 reserves /opt precisely for "the installation of add-on application software packages" —
# self-contained bundles that are not the distribution's own native packaging of a library or CLI
# tool, which is exactly what this is (it doesn't `import`-integrate with the system Python; it
# builds and owns its OWN venv). /usr/lib is more idiomatic for a package that installs INTO the
# system's Python search path — this one deliberately does the opposite (a per-user venv, so N users
# on one machine can each have their own extras/model installs without touching /usr at all), so
# /opt reads the shipped tree for what it is. Matches the macOS bundle's Contents/Resources/appsrc
# and the Windows payload's appsrc/ in spirit: one directory holding exactly the source tree PYTHONPATH
# points at.
#
# PACKAGE NAMES VERIFIED LIVE, not guessed, against `dnf search`/`dnf info` inside a real Fedora
# container (see README-rpm.md's own record of the exact commands + output) — RPM-based distros do
# not share Debian's gir1.2-* naming convention, and getting this wrong fails silently at RUNTIME
# (an ImportError three menus deep, not a `dnf install` error), which is worse than getting it wrong
# at build time.

%global app_version 0.3.7

Name:           sud-workbench
Version:        %{app_version}
Release:        1%{?dist}
Summary:        Desktop editor for SUD/UD/mSUD dependency treebanks in CoNLL-U

# MIT covers the code and assets original to this project (see LICENSE, shipped under /opt/sud-workbench
# and tagged with the license marker in the FILES section below — spelled out here without its
# leading percent sign on purpose: rpmbuild macro-expands ANY percent-prefixed word on ANY line,
# comments included, and warns "Macro expanded in comment" the moment one appears, escaped or not).
# This RPM carries NO vendored subtree of unresolved licence. It used to: grammars/ (the
# surfacesyntacticud/tools grew conversion grammars) has no declared upstream licence and was once
# committed straight into this repo, which is what THIRD-PARTY-NOTICES.md's old "Unresolved:
# grammars/" section was about. That content is no longer in the repo at all — it's fetched on
# demand, onto the END USER's own machine, by app/grammars.py (a new extras tier in app/extras.py,
# the identical licensing-driven shape app/macron.py already uses for the Latin macron data) — so
# this RPM never packages it and there is nothing left here for License: MIT to misstate. Every
# vendored component actually named in THIRD-PARTY-NOTICES.md (Baxter-Sagart data, tshet-uinh data,
# the fastText LID model, …) carries its own compatible-with-redistribution licence.
License:        MIT
URL:            https://github.com/skalyan91/sud-workbench
# Group: is obsolete on Fedora (dropped from the packaging guidelines years ago) and unused by dnf,
# but kept commented here for anyone rebuilding this spec against an older RPM-based distro that
# still expects it (RHEL/CentOS 7-era tooling): Group: Applications/Education
BuildArch:      noarch

Source0:        %{name}-%{version}.tar.gz
Source1:        find_py-rpm.sh
Source2:        setup_venv-rpm.sh
Source3:        sud-workbench.sh
Source4:        sud-workbench.desktop
Source5:        icons.tar.gz

# ── runtime dependencies ─────────────────────────────────────────────────────────────────────────
# ⚠ THIS USED TO BE "RUNTIME LIBRARIES ONLY — NO COMPILER, NO *-devel HEADERS", relying on the venv
# inheriting Fedora's prebuilt python3-gobject/python3-cairo via --system-site-packages. MEASURED
# WRONG, live, in a real Fedora 41 container: python3-gobject's compiled `gi` module lands under
# `/usr/lib64/python3.13/site-packages/`, because Fedora 41's DEFAULT `python3` is 3.13 — and Fedora
# ships no python3.12-targeted PyGObject build at all (`dnf list available 'python3.12*'` lists only
# the interpreter and its -devel/-libs/-tkinter/-idle/-debug/-test siblings). A venv built from the
# pinned `python3.12` therefore could not see `gi` regardless of the flag; confirmed directly with
# `python3.12 -c "import gi"` outside any venv too, same ModuleNotFoundError. See setup_venv.sh's own
# header for the full account of why retargeting the venv at 3.13 instead was rejected. So this list
# now DOES carry the build toolchain — a first launch pays a real compile of PyGObject/pycairo against
# the pinned interpreter, which is slower than a wheel but is the correct, working answer where the
# shortcut was not.
#
#   python3.12           — this project's pinned interpreter (see CLAUDE.md: "spaCy/stanza/torch
#                          wheels are unreliable on 3.14"); the venv is built FROM this exact binary.
#   python3.12-devel     — Python.h + the interpreter's own pkg-config file, which PyGObject's
#                          meson-python build backend needs to compile its C extension against 3.12
#                          specifically (not whatever -devel the system's default python3 already has).
#   gcc                  — the C compiler PyGObject's/pycairo's source builds invoke.
#   pkgconf-pkg-config    — meson (PyGObject's build system) locates gtk3/gobject-introspection/cairo
#                          via pkg-config .pc files; without this, configure fails before it starts.
#   gobject-introspection-devel — girepository headers + .pc file PyGObject's C extension links
#                          against to read .typelib files at runtime.
#   cairo-gobject-devel   — the cairo/GObject integration headers pycairo's build needs.
#   gtk3                 — pywebview's GTK backend (webview/platforms/gtk.py) is GTK3, unconditionally
#                          (`gi.require_version('Gtk','3.0')`) — there is no GTK4 codepath in
#                          pywebview 6.2.1 today. Also what app/linux/shell.py's live theme reader and
#                          native Gtk.MenuBar are built from. Both a runtime dependency (the .so's) and
#                          (via gtk3-devel's absence being fine — see below) not needed at build time
#                          beyond what gobject-introspection-devel's own pkg-config chain pulls in.
#   webkit2gtk4.1        — pywebview's gtk.py tries `gi.require_version('WebKit2','4.1')` +
#                          `Soup 3.0` FIRST and only falls back to WebKit2 4.0 + Soup 2.4 if 4.1's
#                          typelib is missing (webview/platforms/gtk.py, verified against the pinned
#                          pywebview==6.2.1 source, not guessed from docs). Fedora ships the 4.1 API
#                          under this exact package name (the libsoup3-based rebuild; the older
#                          webkit2gtk3/libsoup2 package is legacy and NOT what a fresh install should
#                          pull). Declared as a hard Requires rather than left to the fallback so a
#                          `dnf install` failure surfaces the real ask up front instead of a degraded
#                          WebKit runtime nobody chose.
#
# NOT declared: gtk3-devel, webkit2gtk4.1-devel — PyGObject/pycairo's own builds only need the
# introspection/cairo headers above plus pkg-config visibility into the RUNTIME gtk3/webkit2gtk4.1
# packages already declared (their .pc files ship in the base packages on Fedora); a full -devel
# package per GUI library would be restating what gobject-introspection-devel's own pkg-config chain
# already resolves. gobject-introspection (the bare runtime, not -devel) is pulled in transitively by
# gobject-introspection-devel and gtk3, so it is not named separately either.
Requires:       python3.12
Requires:       python3.12-devel
Requires:       gcc
Requires:       pkgconf-pkg-config
Requires:       gobject-introspection-devel
Requires:       cairo-gobject-devel
Requires:       gtk3
Requires:       webkit2gtk4.1
# git — requirements-core.txt pins `wiktra @ git+https://github.com/twardoch/wiktra2`, so first-launch
# `pip install -r requirements-core.txt` shells out to `git clone` and fails outright without it
# (CONFIRMED live: a fresh Fedora 41 container with every OTHER Requires: installed still failed
# first-launch setup with "ERROR: Cannot find command 'git'"). This is the exact same gap
# packaging/windows/find_py.ps1's sibling find_git.ps1 exists to close on Windows, where git is never
# present by default (see CLAUDE.md's own account of that) — Fedora's own `dnf install git` is the
# equivalent fix here, and unlike Windows there is no "locate or bootstrap" dance needed: git is an
# ordinary Fedora package, so declaring it is the whole fix.
Requires:       git
# hicolor-icon-theme: owns hicolor's index.theme, which is what makes icon lookup fall back to a
# themed icon by NAME (Icon=sud-workbench in the .desktop file) rather than needing a literal path —
# present on essentially every desktop install already, declared explicitly per Fedora packaging
# guidelines rather than assumed.
Requires:       hicolor-icon-theme
# The post-install/post-uninstall scriptlets below call update-desktop-database (desktop-file-utils) and
# gtk-update-icon-cache (already guaranteed by the gtk3 Requires above, so not repeated here) — both
# guarded with `|| :` so a system missing either degrades to "icon/menu caches refresh on next
# reboot or manual `update-desktop-database` run" rather than failing the whole install, but
# Requires(post)/(postun) is what Fedora's own packaging guidelines ask for when a scriptlet's tool
# isn't already guaranteed by another Requires.
Requires(post):   desktop-file-utils
Requires(postun): desktop-file-utils

%description
SUD Workbench is a native-feeling desktop app for viewing and editing dependency treebanks in
CoNLL-U, speaking the SUD relation set (plus UD import/export and mSUD). It provides
five treebank notations (stemma, arcs, tree, brackets, outline), inline morphological glossing,
transliteration for two dozen scripts, on-demand SUD/Stanza parsing models, and byte-stable
CoNLL-U round-tripping.

This package installs the application SOURCE under /opt/sud-workbench (see the header comment in
this spec for why /opt) and a small first-launch bootstrap. The FIRST time you run
`sud-workbench`, it builds a private Python virtual environment for your user account (under
$XDG_DATA_HOME/SUD Workbench/venv, i.e. usually ~/.local/share/SUD Workbench/venv) from the
system's python3.12 and installs the app's core Python dependencies into it — a one-time step
that needs no root privileges (everything requiring root was already satisfied by installing this
RPM). Subsequent launches start directly. Heavier optional parsing tiers (Stanza/torch, Japanese,
Arabic) are offered and installed on demand from inside the app, never at package-install time.

%prep
%setup -q

%build
# Nothing to compile: this package ships Python source + static web assets, run against a per-user
# venv built at first launch (see the header comment). This section being empty is intentional, not
# an oversight — see make_rpm.sh and README-rpm.md for the reasoning this spec's header summarises.

%install
rm -rf %{buildroot}

install -d %{buildroot}%{_bindir}
install -d %{buildroot}/opt/sud-workbench/appsrc
# grammars is deliberately absent from this list — see the header comment above: it is fetched on
# demand by app/grammars.py rather than shipped in the RPM.
cp -a app web %{buildroot}/opt/sud-workbench/appsrc/
install -m 0644 requirements-core.txt %{buildroot}/opt/sud-workbench/requirements-core.txt
install -m 0644 LICENSE %{buildroot}/opt/sud-workbench/LICENSE
install -m 0644 THIRD-PARTY-NOTICES.md %{buildroot}/opt/sud-workbench/THIRD-PARTY-NOTICES.md
install -m 0755 %{SOURCE1} %{buildroot}/opt/sud-workbench/find_py.sh
install -m 0755 %{SOURCE2} %{buildroot}/opt/sud-workbench/setup_venv.sh
install -m 0755 %{SOURCE3} %{buildroot}%{_bindir}/sud-workbench

install -d %{buildroot}%{_datadir}/applications
install -m 0644 %{SOURCE4} %{buildroot}%{_datadir}/applications/sud-workbench.desktop

install -d %{buildroot}%{_datadir}/icons/hicolor
tar -xzf %{SOURCE5} -C %{buildroot}%{_datadir}/icons/hicolor

%files
%license /opt/sud-workbench/LICENSE
%doc /opt/sud-workbench/THIRD-PARTY-NOTICES.md
%{_bindir}/sud-workbench
%dir /opt/sud-workbench
/opt/sud-workbench/requirements-core.txt
/opt/sud-workbench/find_py.sh
/opt/sud-workbench/setup_venv.sh
/opt/sud-workbench/appsrc/
%{_datadir}/applications/sud-workbench.desktop
%{_datadir}/icons/hicolor/*/apps/sud-workbench.*

%post
update-desktop-database %{_datadir}/applications &>/dev/null || :
gtk-update-icon-cache %{_datadir}/icons/hicolor &>/dev/null || :

%postun
update-desktop-database %{_datadir}/applications &>/dev/null || :
gtk-update-icon-cache %{_datadir}/icons/hicolor &>/dev/null || :

%changelog
* Mon Aug 17 2026 Siva Kalyan - 0.3.7-1
- A "punct" deprel on a non-PUNCT token is now strictly forbidden, not just flagged -- enforced
  unconditionally, including the automatic relation the app computes for a re-headed token. See
  CHANGELOG.md.
* Sun Aug 16 2026 Siva Kalyan - 0.3.6-1
- Fixed Japanese running transliteration putting a space after an opening quotation mark.
  Renamed the "Modified Hepburn" transliteration scheme to "Hepburn". The validity checker now
  flags a "punct" deprel on a token whose UPOS isn't PUNCT. See CHANGELOG.md.
* Sun Aug 16 2026 Siva Kalyan - 0.3.5-1
- Added update indicators (green Update button, dropdown marker) for parsers with a newer version
  available, and a progress bar built into the install/update button itself. Fixed the bundled
  English parser failing to actually update, the Sanskrit parser's update appearing to have no
  effect, the progress bar's text contrast and button width, wrapped stemma/tree edge casing, and
  a document's last block capping shorter than the viewport when it had room to spare. Renamed
  "Add sentence" to "Add text". See CHANGELOG.md.
* Sun Aug 16 2026 Siva Kalyan - 0.3.4-1
- Fixed the Feature matrices toggle not hiding AVMs in outline view, Devanagari being wrongly
  refused after the first sentence in an empty Sanskrit document, inserting a sentence scrolling
  to the top instead of to it, AVM causing overflow-without-wrap in several diagram views, a
  Sanskrit MWT sandhi rule that could produce an impossible surface form, the options bar being
  app-wide instead of per-window, and stemma/tree edges not de-colliding where they cross.
  See CHANGELOG.md.
* Sat Aug 15 2026 Siva Kalyan - 0.3.3-1
- Fixed a false attribution (SUD is not Sunflower AI's own relation set),
  documented the Homebrew tap and GitHub Releases in the main README (never
  mentioned before), and relabelled the Show/Hide menu's "Attribute-value
  matrix" to "Feature matrices". See CHANGELOG.md.
* Sat Aug 15 2026 Siva Kalyan - 0.3.2-1
- Arc-endpoint fan-anchor geometry re-derived so adjacent arc/arrowhead
  casings land exactly tangent, replacing several rounds of trig-factor
  tuning with a single closed-form solve shared by both diagram views.
  See CHANGELOG.md.
* Sat Aug 15 2026 Siva Kalyan - 0.3.1-1
- Fix adwaita-kit/ (this package's own chrome) rendering completely unstyled: its
  two stylesheets @import'd macos-kit/, which this very package deliberately
  strips (SF-Symbols licensing). New web/chrome-shared/ gives both kits a base
  neither strips. See CHANGELOG.md.
* Sat Aug 15 2026 Siva Kalyan - 0.3.0-1
- Full dependency licensing audit and disclosure, grew fetched on demand, CAMeL
  Tools removed, SF Symbol icons no longer committed as base64 (rendered at
  packaging time instead, purged from git history). Arc-endpoint trig retune,
  titlebar/editing polish. See CHANGELOG.md.
* Fri Aug 14 2026 Siva Kalyan - 0.2.0-1
- AVM (attribute-value matrix) tier, HarfBuzz native glyph shaping, Arabic/Persian
  vocalisation, titlebar/chrome overhaul, wrapped-diagram layout fixes. See CHANGELOG.md.
* Tue Aug 11 2026 Siva Kalyan - 0.1.0-1
- Initial RPM packaging: bootstrap-venv distribution model, matching macOS/Windows.
