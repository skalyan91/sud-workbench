/*
  SUD Workbench — plain (non-flake) Nix derivation, Linux/NixOS only.

  THIS FILE, NOT flake.nix, IS THE SOURCE OF TRUTH. flake.nix now just calls this file's function
  with a pinned nixpkgs (`pkgs.callPackage ./default.nix {}`), so a flake user and a classic-Nix/
  Home Manager user get IDENTICAL package logic — nothing here is duplicated or re-derived in the
  flake, and a change to one dependency pin only ever needs to happen once.

  WHY THIS FILE EXISTS SEPARATELY FROM flake.nix. Flakes are one interface to Nix, not the only
  one, and plenty of real Nix users — Home Manager's classic (non-flake) setup very much included —
  never touch `nix flake`/`flake.lock` at all: they pin nixpkgs via a channel or a `sources.nix`/
  niv-style pin, and consume packages via `pkgs.callPackage`/`import`/an overlay, exactly the way
  every package in nixpkgs itself is written. A flake-only `flake.nix` would have made this project
  simply unusable from that workflow — not harder, unusable, since there is no `pkgs.callPackage
  ./flake.nix {}` (a flake's `outputs` function has a different, incompatible calling convention:
  `{ self, nixpkgs, ... }`, not the auto-arg `{ lib, pkgs, ... }` shape `callPackage` fills in).
  So the actual derivation logic lives in a plain function here, and flake.nix becomes the thin
  wrapper — the opposite of how this file started (as flake.nix's own inline `mkSudWorkbench`,
  moved out verbatim; see the git history on flake.nix for that derivation's full original
  provenance comment, preserved below unchanged).

  HOW TO USE THIS FROM HOME MANAGER (no flakes):
    In ~/.config/nixpkgs/home.nix (or wherever your Home Manager config lives):

      { pkgs, ... }:
      {
        home.packages = [
          (pkgs.callPackage /path/to/sud-workbench/default.nix { })
        ];
      }

    …or, without a local checkout, fetch the source directly. `builtins.fetchGit` shells out to
    your OWN machine's `git`, impurely, at evaluation time (not inside Nix's build sandbox) — so it
    authenticates exactly the way a plain `git clone` from that same shell would, private repos
    included, as long as the credentials your `git` already uses (an SSH key in your agent, a
    stored HTTPS credential helper, …) are set up on the machine running `home-manager switch`. An
    `ssh://` URL is the more commonly-set-up path for a private repo (matches an SSH key/deploy key
    in your agent); swap in `https://github.com/...` if you use a credential helper instead:

      { pkgs, ... }:
      let
        sud-workbench-src = builtins.fetchGit {
          url = "ssh://git@github.com/skalyan91/sud-workbench.git";
          ref = "main";
        };
      in
      {
        home.packages = [ (pkgs.callPackage "${sud-workbench-src}/default.nix" { }) ];
      }

    Or register it as an overlay, if you'd rather refer to it as `pkgs.sud-workbench` everywhere:

      nixpkgs.overlays = [
        (final: prev: { sud-workbench = prev.callPackage /path/to/sud-workbench/default.nix { }; })
      ];
      home.packages = [ pkgs.sud-workbench ];

    Plain `nix-build` also works, same as any other non-flake Nix package:
      nix-build default.nix -A sud-workbench    # or just: nix-build default.nix
      ./result/bin/sud-workbench

  THE ONE REAL TRADE-OFF OF GOING NON-FLAKE: no flake.lock, so no automatic, hermetic pin of
  nixpkgs itself — `pkgs.callPackage` uses WHATEVER nixpkgs your own Home Manager config/channel
  already resolved to, not the exact revision this file was verified against. That matters here
  specifically because `python3Packages.spacy` must be in `[3.8.14, 3.9.0)` — see "NIXPKGS
  REVISION" below for why — so this file ASSERTS that range at eval time (a clear error naming
  what's wrong, rather than a build that succeeds and then fails to load `en_sud_ewt_gum` later, or
  worse, silently loads it against a spaCy it wasn't validated against). If you hit that assertion,
  either pin your channel to (or newer than) the nixpkgs revision named below, or wait for your
  channel to catch up to a nixpkgs commit in that spaCy range. A flake user (`nix build`/`nix run`
  via flake.nix) does NOT need to think about this at all — flake.lock pins it exactly, every time.

  WHY LINUX ONLY. The other three packaging tracks (packaging/make_bootstrap_app.sh,
  packaging/make_portable.sh, packaging/windows/make_win_app.py) all ship SOURCE plus a
  first-launch bootstrap that builds a venv from whatever Python 3.12 it finds on the target
  machine — because at *build* time they cannot know the target's OS/libc/Python ABI, and don't
  want to vendor compiled wheels for every combination up front. Nix inverts that: the target
  environment is not a variable to hedge against, it's an INPUT the derivation declares and Nix
  builds hermetically. So this derivation does the opposite of every other packaging/ script on
  purpose — every dependency (interpreter, every pip package, every system library) is built or
  fetched by Nix itself, with no runtime `pip install` step needed to STAND THE APP UP. That is a
  claim about the app's own closure, not a ban on pip: downloading a parser model is a thing the
  USER does at runtime, on any platform, and `py.pip` is in `propagatedBuildInputs` precisely so
  they can — see "MODELS ARE DOWNLOADABLE HERE" below. `app/mac/` (AppKit/PyObjC)
  and `app/win/` (WinForms/DWM/pythonnet) are native-shell code for platforms Nix doesn't target;
  this file never imports them (`app/__main__.py`'s own `sys.platform` dispatch already keeps
  them out of the Linux code path — see `IS_MAC`/`IS_WIN`/`IS_LINUX` there). `app/linux/shell.py`
  (GTK3 live-theme reading + a native `Gtk.MenuBar` built from `app/menu_spec.py`) is the code
  path this derivation exists to run, and its two `import gi` call sites are exactly why PyGObject +
  a WebKitGTK typelib are hard package dependencies below, not merely pywebview's.

  CORE ONLY — DELIBERATELY. `app/extras.py`'s three pip-installed-on-demand tiers (`stanza`
  →torch/transformers, `japanese`→cutlet/fugashi/unidic-lite, `arabic`→camel-tools) and the
  `la_macron` data tier are NOT in this derivation's closure. That is the same scope boundary
  every other packaging track draws (`requirements-core.txt` vs `requirements.txt`) — the app is
  designed to run and degrade gracefully with all four absent (a toast, not a crash; see
  `app/extras.py`'s own docstring and CLAUDE.md's "Parsing, models, and on-demand extras"). Adding
  torch to a from-source Nix closure is a real, separate undertaking (CUDA/ROCm/CPU variant
  matrix, multi-GB build) out of scope here too. A NixOS/Home-Manager user who wants one of those
  tiers can still let `app/extras.py` pip-install it into `~/.local/share/SUD Workbench/
  site-packages` at runtime exactly as any other Linux distro's user would — this derivation
  doesn't block that, it just doesn't pre-build it.

  MODELS ARE DOWNLOADABLE HERE, AND `py.pip` IS THE ONE LINE THAT MAKES THAT TRUE. The paragraph
  above USED to make that same "a user can still pip-install it at runtime" claim while nothing in
  this closure could run pip at all, so it was false — measured, not merely suspected: nixpkgs
  builds CPython with `--without-ensurepip` (unconditional, in `pkgs/development/interpreters/
  python/cpython/default.nix`), so `sys.executable -m pip` answers `No module named pip` unless pip
  is a package IN THE SAME python environment. And `app/models_registry.py`'s `download()` shells
  out to exactly that, for every SUD model wheel and for whatever a wheel's own `Requires-Dist`
  turns out to need, as does every pip tier in `app/extras.py`. So a Nix install could offer a
  model list, let a reader press Install, and fail — the ONLY model it could ever parse with was
  the one bundled in this closure. `py.pip` in `propagatedBuildInputs` (below) is what fixes it:
  `wrapPythonPrograms` puts propagated inputs on the launcher's `PYTHONPATH`, which is the same
  thing `python312.withPackages (ps: [ ps.pip ])` does and the reason a bare `nix shell
  nixpkgs#python312 nixpkgs#python312Packages.pip` does NOT work (two store paths, only `bin/` is
  merged). Verified in a `nixos/nix` container on aarch64-linux, both halves.

  ⚠ AND A PREBUILT MANYLINUX WHEEL LOADS HERE AS-IS — no `LD_LIBRARY_PATH` prefix, no `nix-ld`, no
  `autoPatchelf`, which is the opposite of what the usual NixOS folklore about foreign binaries
  would lead you to expect, so it was measured rather than assumed. `pip install --target` of
  `vidyut` (the Sanskrit model's Rust-backed morphological lexicon — see `app/vidyut_data.py`)
  followed by `import vidyut; vidyut.lipi.transliterate("rāma", Iast, Devanagari)` answers `राम` in
  a plain `python312.withPackages` environment. Reading that `.so`'s dynamic section says why:
  `DT_NEEDED` is `libgcc_s.so.1`, `librt`, `libpthread`, `libm`, `libdl`, `libc` and the loader —
  all glibc-family, and all already mapped into the process by this closure's own CPython, so they
  resolve by soname from the loaded set rather than by searching a path. There is no RUNPATH and it
  does not need one. A wheel that pulls a genuinely FOREIGN library (torch's CUDA stack being the
  obvious one) is a different question and is not answered by this; the `stanza` tier stays
  out-of-scope exactly as the paragraph above says.

  NIXPKGS REVISION THIS WAS VERIFIED AGAINST: `NixOS/nixpkgs` commit
  `a769e26b6c0948d1b5b4e9f52533f49110a1e795` (`master`, 2026-08-11) — at this revision,
  `python312Packages.spacy` is version **3.8.14**, matching `requirements-core.txt`'s
  `spacy==3.8.14` pin EXACTLY (verified by reading `pkgs/development/python-modules/spacy/
  default.nix` at this commit, not assumed) — which matters because the bundled `en_sud_ewt_gum`
  model wheel declares `Requires-Dist: spacy<3.9.0,>=3.8.14` and pip refuses to resolve a looser spaCy
  against it (see requirements-core.txt's own comment on that exact pin). A flake user gets this
  exact revision via flake.lock; a non-flake caller is asserted against the same range (see above)
  rather than silently trusting their own channel.

  DEPENDENCY RESOLUTION — what came from nixpkgs directly vs what had to be hand-packaged, and
  why, package by package:

  · spaCy's own dependency tree (thinc, numpy, murmurhash, cymem, preshed, srsly, wasabi,
    catalogue, blis, click, …) — all present in nixpkgs under matching names; used via
    `python312Packages.spacy`'s own propagated closure, nothing re-specified here.
  · requests, beautifulsoup4, pypinyin, lxml, fonttools, langcodes, pyyaml, regex, tqdm, roman,
    typer, toml, lark, unicodedata2, language-data, pygobject3, pycairo, responses, pykakasi —
    all present in nixpkgs under their PyPI-matching names (grepped `pkgs/top-level/
    python-packages.nix` at the pinned revision directly, not guessed).
  · fasttext-wheel==0.9.2 → substituted with nixpkgs' `fasttext` (NOT `fasttext-wheel`). Read
    nixpkgs' own `pkgs/development/python-modules/fasttext/default.nix`: it builds
    `pkgs.fasttext`'s Python bindings from the SAME upstream (facebookresearch/fastText) that
    `fasttext-wheel` on PyPI merely repackages as a prebuilt binary wheel — `fasttext-wheel`
    exists purely so `pip install` doesn't need a C++ compiler at install time, which is not a
    constraint Nix has (it always builds from source). Same Python API, including the `model.f`
    attribute `app/langid.py` reaches for (both packages vendor the identical `FastText.py`
    wrapping the same pybind11 module), so the substitution is behaviourally inert.
  · pywebview==6.2.1 → NOT used from nixpkgs (which currently ships 6.1, pinned to the Qt/pyside6
    backend + macOS pyobjc extras and NO GTK wiring at all — checked its actual
    `default.nix`). This app needs the GTK3 + WebKit2GTK-4.1 backend specifically
    (`app/linux/shell.py` restructures pywebview's OWN GTK widget tree by reading
    `webview/platforms/gtk.py`'s source, so the backend choice isn't incidental). Rather than
    override nixpkgs' `rec`-attrset derivation (version and dependencies are awkward to patch
    cleanly through `overrideAttrs` once `dependencies` has already been consumed into
    `propagatedBuildInputs`), a fresh `buildPythonPackage` stanza fetches the exact 6.2.1 wheel
    from PyPI (pure `py3-none-any`, no compiled extension — sidesteps pywebview's setuptools-scm
    versioning entirely) and lists `pygobject3`+`pycairo` as its GTK-side Python dependencies,
    dropping the pyside6/pyobjc extras nixpkgs' recipe carries unconditionally, since this build
    targets exactly one backend on exactly one platform.
  · webkitgtk_4_1 — this is `webkitgtk_6_0.override { gtk4 = gtk3; }` in nixpkgs (read directly
    off `pkgs/top-level/all-packages.nix`): the WebKit2 4.1 API surface built against GTK3, not
    GTK4. That is exactly what `webview/platforms/gtk.py` asks for
    (`gi.require_version('WebKit2','4.1')` alongside `gi.require_version('Gtk','3.0')`, confirmed
    by reading that file at the pywebview 6.2.1 tag) and what `app/linux/shell.py` assumes
    (`Gtk.OffscreenWindow`, `Gtk.MenuBar`, `Gtk.HeaderBar` — GTK3 API). `webkitgtk_4_0` (the
    libsoup2 predecessor) is being retired from nixpkgs precisely because of packages depending on
    it (see `pkgs/top-level/aliases.nix`'s removal notes) — 4.1 is the maintained, correct choice,
    not a compatibility fallback.
  · The nativeBuildInputs/buildInputs shape for a PyGObject+WebKitGTK Python app (gobject-
    introspection + wrapGAppsHook3 as native inputs; gtk3, webkitgtk_4_1, glib-networking,
    gdk-pixbuf, adwaita-icon-theme as build inputs, so GI_TYPELIB_PATH/XDG_DATA_DIRS/etc. land on
    the wrapped executable) is copied from nixpkgs' own `pkgs/by-name/py/pytrainer/package.nix` —
    a real, currently-building nixpkgs package with the identical shape (buildPythonApplication +
    GTK3 + webkitgtk_4_1), read directly rather than reconstructed from general GTK-packaging
    folklore.
  · Everything else requirements-core.txt names that nixpkgs does NOT package —
    conllu, aksharamukha, indic-transliteration, ToJyutping, opencc-python-reimplemented,
    hangul-romanize, uroman, grewpy, en_sud_ewt_gum, and wiktra's own two undeclared PyPI dependencies
    (pywikiapi, yaplon) plus TWO of yaplon/indic-transliteration's own further-transitive
    dependencies nixpkgs doesn't carry either (orderedattrdict, backports.functools_lru_cache),
    plus pywikiapi's own declared `responses` dependency — is hand-packaged below as a plain
    `buildPythonPackage { format = "wheel"; }` pointed at the exact `files.pythonhosted.org` wheel
    URL and sha256 PyPI's OWN JSON API reports for that exact version. Every one of these ships a
    universal `py3-none-any` (or `py2.py3-none-any`) wheel with no compiled extension, so
    `format = "wheel"` is exact — no build step, no build-system inputs, just unpack-and-install —
    and every one carries a `pythonImportsCheck` so a broken transitive-dependency listing fails
    the BUILD, not a later launch.
  · wiktra has no PyPI release at all — requirements-core.txt's `wiktra @
    git+https://github.com/twardoch/wiktra2` names no rev, so pip resolves whatever `master`'s
    HEAD is at install time. That floating target can't be hermetic, so this pins it to the
    commit that WAS `master`'s HEAD while this was written — `fe50b1d45073e159d110836591e67
    b14e21294f2` (2025-06-29, tagged "v1.0.0" in its own commit message, though the repo carries
    no matching git tag) — via `pkgs.fetchgit`. Bump this rev deliberately; don't let it silently
    drift.
  · wiktra's own `setup.py` reads `install_requires` from its `requirements.txt`
    (fonttools[unicode], langcodes[data], lupa, pywikiapi, yaplon) — Nix has no extras mechanism,
    so the two bracketed extras are expressed as plain extra propagatedBuildInputs
    (`unicodedata2` for fonttools' `[unicode]`, `language-data` for langcodes' `[data]`) rather
    than silently dropped; `lupa` (LuaJIT binding — wiktra runs actual Wiktionary Lua
    transliteration modules) is a plain nixpkgs package.

  WHAT WAS ACTUALLY VERIFIED, HONESTLY, FOR THIS FILE'S ORIGINAL FLAKE FORM: see flake.nix's own
  git history for the full "WHAT WAS ACTUALLY VERIFIED" account (real `nix build` inside a
  `nixos/nix` Docker container, `nix derivation show` cross-checks on the doCheck/weasel/spacy
  fixpoint rewiring below, `pythonImportsCheck` running for real, and two real boot attempts —
  reaching a live `app/linux/shell.py` GTK3 theme-read against a virtual X server before stopping
  on a headless-container EGL limitation unrelated to this packaging). This file (the classic,
  non-flake form) was additionally verified with a real, non-flake `nix-build` — see this
  project's CLAUDE.md / packaging/nix/README.md for that specific run's record.
*/
{ pkgs ? import <nixpkgs> {} }:
let
  lib = pkgs.lib;

  # nixpkgs' own python312Packages.spacy pulls `weasel` (spaCy's `project`/`huggingface-hub`
  # CLI helper) AND `spacy-loggers` (its Weights & Biases/MLflow logging integration) as
  # UNCONDITIONAL runtime `dependencies` — that much is upstream spaCy's own
  # install_requires, present whether installed via pip or Nix, and not this derivation's
  # to second-guess. The actual bloat is `doCheck = true` defaults on packages BELOW those
  # two, each pulling a huge SDK surface into its OWN build purely to test itself, never
  # into anything's runtime closure — TWO independent chains, found one at a time by asking
  # `nix why-depends .#default <drv>` for a concrete unwanted derivation rather than
  # guessing from the dependency tree in the abstract (recorded below because the second
  # chain looks nothing like the first, and guessing would have stopped after the first):
  #   1. spacy → weasel → cloudpathlib/smart-open, whose bare `dependencies` are tiny
  #      (smart-open: just `wrapt`; cloudpathlib: nothing beyond its own build system) but
  #      whose `nativeCheckInputs` unconditionally add `optional-dependencies.all`/`moto`/
  #      `awscli2` — boto3, google-cloud-storage, azure-storage-blob, and (through THEIR own
  #      doCheck) moto, aws-sam-translator, cfn-lint, google-cloud-bigquery.
  #   2. spacy → spacy-loggers → wandb, whose bare `dependencies` are equally tiny (click,
  #      packaging, protobuf, pydantic, pyyaml, requests, sentry-sdk, …) but whose
  #      `nativeCheckInputs` add pandas, scikit-learn, matplotlib, moto (again), and finally
  #      PyTorch + torchvision — wandb tests its own ML-framework integrations.
  #   (Read directly off each package's own `pkgs/development/python-modules/*/default.nix`
  #   at the pinned revision, not inferred from the build log alone.) Neither chain reaches
  #   `propagatedBuildInputs` anywhere along it, so silencing both changes nothing about what
  #   spaCy (or this app) can actually DO — only what nixpkgs makes itself prove first.
  #
  #   Fixed at the ROOT via `packageOverrides` — but plain `packageOverrides = self: super:
  #   { X = super.X.overridePythonAttrs (_: { doCheck = false; }); }`, tried FIRST, measurably
  #   DID NOT WORK for the chain it targeted (confirmed: `nix build`'s "will be built" preview
  #   only moved 182→170 derivations, the whole cloudpathlib/smart-open/torch tail still
  #   present) — and the reason is a real Nix fixpoint gotcha worth recording. `super.spacy`
  #   is a FINISHED derivation, already built inside NIXPKGS' OWN internal fixpoint, whose
  #   `weasel` dependency edge was resolved to a CONCRETE store path (`super.weasel`, doCheck
  #   still true) the moment `super.spacy = callPackage ./spacy {}` was evaluated —
  #   `.overridePythonAttrs` patches attributes of an ALREADY-RESOLVED recipe (right tool for
  #   flipping spaCy's OWN `doCheck`) but cannot retroactively change WHICH weasel derivation
  #   got baked into `super.spacy`'s `propagatedBuildInputs`; the new `self.weasel` binding
  #   existed but nothing spaCy actually built ever pointed at it. `.override { weasel =
  #   self.weasel; }` is the different, correct tool: it RE-INVOKES spaCy's own `default.nix`
  #   FUNCTION with `weasel` rebound to whatever is passed, through THIS fixpoint's `self` —
  #   genuinely rewiring the edge, cascaded one hop at a time (weasel's own `cloudpathlib`/
  #   `smart-open` args, spacy-loggers' own `wandb` arg, each rebound the same way) so every
  #   hop resolves through `self`, not just the outermost one. Verified two ways before
  #   trusting it: `nix eval` confirmed `spacy.propagatedBuildInputs`'s `weasel` entry is
  #   BYTE-IDENTICAL to the standalone doCheck=false `weasel` derivation's own store path
  #   (not merely same version), and `nix derivation show` on that exact weasel .drv (the one
  #   `nix build --dry-run` actually queued) shows `"doCheck":""` (Nix's false) and a
  #   `cloudpathlib` input matching the doCheck=false one — i.e. checked what would actually
  #   be BUILT, not a hand-copied stand-in expression.
  python3 = pkgs.python312.override {
    packageOverrides = self: super: {
      cloudpathlib = super.cloudpathlib.overridePythonAttrs (_: { doCheck = false; });
      smart-open = super.smart-open.overridePythonAttrs (_: { doCheck = false; });
      wandb = super.wandb.overridePythonAttrs (_: { doCheck = false; });
      weasel = (super.weasel.override {
        cloudpathlib = self.cloudpathlib;
        smart-open = self.smart-open;
      }).overridePythonAttrs (_: { doCheck = false; });
      spacy-loggers = (super.spacy-loggers.override {
        wandb = self.wandb;
      }).overridePythonAttrs (_: { doCheck = false; });
      spacy = (super.spacy.override {
        weasel = self.weasel;
        spacy-loggers = self.spacy-loggers;
      }).overridePythonAttrs (_: { doCheck = false; });
    };
  };
  py = python3.pkgs;

  # A non-flake caller supplies THEIR OWN pkgs, so there is no flake.lock to guarantee the spaCy
  # version en_sud_ewt_gum was built against (see the file header's "ONE REAL TRADE-OFF" note) — fail
  # loudly and specifically here, at eval time, rather than let a mismatched spaCy build "succeed"
  # and only misbehave once the app actually tries to load the bundled model.
  spacyOk = lib.versionAtLeast py.spacy.version "3.8.14" && lib.versionOlder py.spacy.version "3.9.0";

  # ── hand-packaged CORE deps nixpkgs doesn't carry ──────────────────────────────────
  # Every wheel URL + sha256 below is copied verbatim from PyPI's OWN `/pypi/<name>/json`
  # response for the exact pinned version. `format = "wheel"` because every one of these is a pure
  # `py3-none-any`/`py2.py3-none-any` wheel: no compiled extension, so there is no build
  # step, only unpack-and-install, and no build-system inputs are needed.

  conllu = py.buildPythonPackage {
    pname = "conllu";
    version = "6.0.0";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/18/64/8f26d84f18c4d421cc7ca8f4b1dfd080ae14ba15a627277fbd63c11d652e/conllu-6.0.0-py3-none-any.whl";
      sha256 = "c47206a0912f768bfae429d3d3c2c7f5ed068babd2502663e865cfb21532cbcc";
    };
    doCheck = false;
    pythonImportsCheck = [ "conllu" ];
    meta.license = lib.licenses.mit;
  };

  # pywikiapi's own PyPI metadata (Requires-Dist) lists BOTH of these unconditionally, no
  # extras marker on `responses` — included even though it reads like a test-only mocking
  # lib, on the basis that PyPI's own metadata says otherwise and we didn't want to guess.
  responses = py.buildPythonPackage {
    pname = "responses";
    version = "0.26.2";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/7c/28/693e1d9ebf72baa062ded80d837a035b86ce75eda5a269379e9e2b1008a8/responses-0.26.2-py3-none-any.whl";
      sha256 = "6fdfeabd58e5ec473b98dfe02e6d46d3173bd8dd573eff2ccccf1a05a5135364";
    };
    propagatedBuildInputs = [ py.requests py.urllib3 py.pyyaml ];
    doCheck = false;
    pythonImportsCheck = [ "responses" ];
    meta.license = lib.licenses.asl20;
  };

  pywikiapi = py.buildPythonPackage {
    pname = "pywikiapi";
    version = "5.0.0";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/7b/9d/bdaf407c2d559ed51fc1bdd1836c04321635c0c078499532564c01ba92f7/pywikiapi-5.0.0-py3-none-any.whl";
      sha256 = "209d209ecd96bfdd5845c228c929d5a430c5aa98b266b86c6a544fe0b90fb229";
    };
    propagatedBuildInputs = [ py.requests responses ];
    doCheck = false;
    pythonImportsCheck = [ "pywikiapi" ];
    meta.license = lib.licenses.mit;
  };

  orderedattrdict = py.buildPythonPackage {
    pname = "orderedattrdict";
    version = "1.6.0";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/f3/29/b9fc8515d60bf1bb13e206c2bce356abd8e98a01128f9200387747c4996b/orderedattrdict-1.6.0-py2.py3-none-any.whl";
      sha256 = "3651524e352ceff85f45bc16eeb917123c06e16f65ca501f79de5bdd7f269bf3";
    };
    doCheck = false;
    pythonImportsCheck = [ "orderedattrdict" ];
    meta.license = lib.licenses.mit;
  };

  yaplon = py.buildPythonPackage {
    pname = "yaplon";
    version = "1.6.0";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/4c/1b/ae40459d6be1cd43f25de95eae4168de906094757fb2ff41780212ec8f86/yaplon-1.6.0-py3-none-any.whl";
      sha256 = "484f9cf1bd3f212f00dd9c03f69b65929fa0a6dd1afca210d57fba00d1bb7f07";
    };
    propagatedBuildInputs = [ py.pyyaml py.click py.dict2xml orderedattrdict py.xmltodict ];
    doCheck = false;
    pythonImportsCheck = [ "yaplon" ];
    meta.license = lib.licenses.mit;
  };

  backportsFunctoolsLruCache = py.buildPythonPackage {
    pname = "backports.functools_lru_cache";
    version = "2.0.0";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/c6/c6/4761a2ccb03d650ca803b11a7cdd69ff0696926d3fea218c8ca22c808448/backports.functools_lru_cache-2.0.0-py2.py3-none-any.whl";
      sha256 = "0a754323a46847735a112677fb8807b45f6d824d02a5795a50905218ac56a0d6";
    };
    doCheck = false;
    pythonImportsCheck = [ "backports.functools_lru_cache" ];
    meta.license = lib.licenses.mit;
  };

  grewpy = py.buildPythonPackage {
    pname = "grewpy";
    version = "0.7.1";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/63/71/f3252b9fbea382450bfab72bb7d9db57ff27e25b9439a602db5c96ded88d/grewpy-0.7.1-py3-none-any.whl";
      sha256 = "705707d67b571c82c7d58a8a2fa78b3b799c314414afe72026e1e547f5d02a80";
    };
    propagatedBuildInputs = [ py.numpy py.lark ];
    doCheck = false;
    # NOT pythonImportsCheck'd, and that omission is itself a finding worth recording: a
    # bare `import grewpy` — not a call, the plain import — unconditionally spawns the
    # `grewpy_backend` OCaml binary and raises `FileNotFoundError: grewpy_backend` if it
    # isn't on PATH (confirmed live: this derivation failed the build with exactly that
    # traceback until the check below was dropped). So CLAUDE.md's "the OCaml backend is an
    # optional external prereq… without it the app still runs" is true only because
    # app/convert.py's OWN call sites wrap grewpy in a try/except that catches this — it is
    # NOT true of the bare package, which is why a generic `pythonImportsCheck = ["grewpy"]`
    # is the wrong check here (it asserts something upstream grewpy does not promise) rather
    # than an argument for bundling the backend, which stays out of scope per this file's
    # own CORE-only boundary (see file header).
    meta.license = lib.licenses.mit;
    meta.longDescription = ''
      Python client only — the OCaml `grewpy_backend` (opam) that actually performs UD↔SUD
      graph rewriting is a documented optional external prerequisite (CLAUDE.md: "The
      backend is an optional external prereq") and is DELIBERATELY NOT part of this Nix
      closure, matching every other packaging track: without it the app still runs and
      edits SUD/mSUD, only UD import/export/conversion (and, per CLAUDE.md, Stanza's own
      UD→SUD step) are disabled, surfaced as a toast rather than a crash — a behaviour
      that lives in app/convert.py's own error handling around grewpy, not in grewpy
      itself (see the note above the deliberately-absent pythonImportsCheck).
    '';
  };

  enSudEwtGum = py.buildPythonPackage {
    pname = "en_sud_ewt_gum";
    version = "0.2.0";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://github.com/SunflowerAI/sud-spacy-parsers/releases/download/v0.2.0/en_sud_ewt_gum-0.2.0-py3-none-any.whl";
      # Not on PyPI (it's a GitHub Release asset — see requirements-core.txt's own comment
      # on why: SUD-spaCy model wheels are published there, not to PyPI).
      sha256 = "bafc616fd75c74bb847d5b04cd6932525b715988a4efaf364627c54936b6d1c3";
    };
    propagatedBuildInputs = [ py.spacy ];
    doCheck = false;
    pythonImportsCheck = [ "en_sud_ewt_gum" ];
    meta.license = "CC-BY-SA-4.0";
    meta.longDescription = ''
      The one model this app ships WITH rather than downloads on demand — needed by
      app/wiktionary.py to SUD-parse Wiktionary definition prose regardless of the open
      document's own language. Requires spacy>=3.8.14,<3.9.0 per its own METADATA — see
      the file header's spaCy-range assertion, which this derivation depends on holding.

      Was `en_sud_ewt` 0.1.0 until that wheel was retired (app/models_registry.py's
      RETIRED_SUD): same pipeline, trained on SUD_English-EWT PLUS the ten GUM genres
      whose sources upstream keeps free of the NonCommercial restriction, so this wheel
      too declares CC BY-SA 4.0 in its own METADATA. The sha256 above is of the release
      asset itself, taken with `shasum -a 256` over the downloaded wheel.
    '';
  };

  aksharamukha = py.buildPythonPackage {
    pname = "aksharamukha";
    version = "2.3";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/5b/07/63495f4fb3be0a84025bdac9469a8737e1b71668c64bedfb77b3d160efbe/aksharamukha-2.3-py3-none-any.whl";
      sha256 = "aaaccff78c2ecfaa1e39df12c29eeecbe9dece19508221347855974d1d3e2446";
    };
    # PyPI Requires-Dist: Requests, pykakasi, PyYAML, langcodes, language-data, regex,
    # fonttools[unicode], lxml. The [unicode] extra -> unicodedata2 added explicitly, same
    # reasoning as wiktra's own fonttools[unicode]/langcodes[data] below.
    propagatedBuildInputs = [
      py.requests py.pykakasi py.pyyaml py.langcodes py.language-data py.regex
      py.fonttools py.unicodedata2 py.lxml
    ];
    doCheck = false;
    pythonImportsCheck = [ "aksharamukha" ];
    meta.license = lib.licenses.mit;
  };

  indic-transliteration = py.buildPythonPackage {
    pname = "indic-transliteration";
    version = "2.3.82";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/a2/c1/65ae96680758615e042415fb1d3a1e573c2419387205135501d96be97bb8/indic_transliteration-2.3.82-py3-none-any.whl";
      sha256 = "243b8a444f14c1a811c03ba07e8aa300da61a7c4172a45556fdce1d963038019";
    };
    # PyPI Requires-Dist base set (the "extras"/"test" markers are skipped — this app only
    # imports the plain package, per its own comment in requirements-core.txt: "the
    # Sanskrit parser's OWN Devanagari→IAST front end").
    propagatedBuildInputs = [
      backportsFunctoolsLruCache py.regex py.typer py.toml py.roman py.tqdm
    ];
    doCheck = false;
    pythonImportsCheck = [ "indic_transliteration" ];
    meta.license = lib.licenses.mit;
  };

  toJyutping = py.buildPythonPackage {
    pname = "ToJyutping";
    version = "3.2.0";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/21/73/232b2ddc09db98b1ae37df6aebffa9c4808196e588d73f40cd6d26596cb7/ToJyutping-3.2.0-py3-none-any.whl";
      sha256 = "af7fe10095a3ce91b5cf2bcd7e7c62002407f432c3083562f725ddc140c6fd7e";
    };
    doCheck = false;
    pythonImportsCheck = [ "ToJyutping" ];
    meta.license = lib.licenses.mit;
  };

  openccPythonReimplemented = py.buildPythonPackage {
    pname = "opencc-python-reimplemented";
    version = "0.1.7";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/30/6b/055b7806f320cc8f2cdf23c5f70221c0dc1683fca9ffaf76dfc2ad4b91b6/opencc_python_reimplemented-0.1.7-py2.py3-none-any.whl";
      sha256 = "41b3b92943c7bed291f448e9c7fad4b577c8c2eae30fcfe5a74edf8818493aa6";
    };
    doCheck = false;
    pythonImportsCheck = [ "opencc" ];
    meta.license = lib.licenses.asl20;
    meta.longDescription = ''
      Deliberately NOT nixpkgs' own `opencc` (the C++/pybind OpenCC bindings) — CLAUDE.md
      names `opencc-python-reimplemented` specifically ("OpenCC (already core, via
      translit's Traditional orthography)") and the two packages' config-name/API surfaces
      are not guaranteed identical; substituting the C++ binding would be an unreviewed
      behavioural change.
    '';
  };

  hangul-romanize = py.buildPythonPackage {
    pname = "hangul-romanize";
    version = "0.1.0";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/e9/12/c5d2efd69d634d33c1a0a90256116bdefd023b27ca477f1fc5c7620aa21f/hangul_romanize-0.1.0-py3-none-any.whl";
      sha256 = "7b8ba54b624ca3b17b2c9394b971cd595c4240a31cc0fc6bc1c3e971eca8c4d5";
    };
    doCheck = false;
    pythonImportsCheck = [ "hangul_romanize" ];
    meta.license = lib.licenses.mit;
  };

  uroman = py.buildPythonPackage {
    pname = "uroman";
    version = "1.3.1.1";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/78/e1/43722c41eebab0592c6f83410e5e35edc1d6e333f44feb0a543bd38dba3e/uroman-1.3.1.1-py3-none-any.whl";
      sha256 = "394f965f7011fd56a84aca098a6c3b50082f365324f5d94c992852137918c8f5";
    };
    propagatedBuildInputs = [ py.regex ];
    doCheck = false;
    pythonImportsCheck = [ "uroman" ];
    meta.license = lib.licenses.asl20;
  };

  pywebview = py.buildPythonPackage {
    pname = "pywebview";
    version = "6.2.1";
    format = "wheel";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/3d/25/9491695c22c4842c5b3903b4dc172e0eecf67a27c0af34a71512c9b76a0a/pywebview-6.2.1-py3-none-any.whl";
      sha256 = "9d07275f53894ab4d5e2e0e996227193e7187dec276d9b624dccbce029216b46";
    };
    # Base deps (pywebview's own METADATA, unconditional): proxy_tools, bottle,
    # typing_extensions. GTK backend deps (METADATA's `extra == "gtk"`, pinned there to
    # PyGObject==3.50.0 — nixpkgs' own pygobject3, whatever recent 3.5x it carries, is used
    # instead: pip's exact pin is about resolver behaviour, not an ABI this app depends on).
    # pyside6/pyobjc extras nixpkgs' OWN pywebview recipe carries unconditionally are
    # deliberately absent — this build targets exactly the GTK3/WebKit2GTK-4.1 backend.
    propagatedBuildInputs = [ py.bottle py.proxy-tools py.typing-extensions py.pygobject3 py.pycairo ];
    doCheck = false;
    pythonImportsCheck = [ "webview" ];
    meta.license = lib.licenses.bsd3;
  };

  # wiktra has no PyPI release (requirements-core.txt: `wiktra @ git+https://github.com/
  # twardoch/wiktra2`, no rev = pip resolves master's HEAD at install time). Pinned to the
  # commit that WAS master's HEAD while this was written — see the file header for
  # exactly why fetchgit (not fetchFromGitHub).
  wiktra = py.buildPythonPackage {
    pname = "wiktra";
    version = "1.0.0-unstable-2025-06-29";
    format = "setuptools";
    src = pkgs.fetchgit {
      url = "https://github.com/twardoch/wiktra2";
      rev = "fe50b1d45073e159d110836591e67b14e21294f2";
      hash = "sha256-6rRa+cCxnpk/zYOwwt9XGbrlFOAXStppIpM4aPbSOPE=";
    };
    propagatedBuildInputs = [
      py.lupa py.fonttools py.unicodedata2 py.langcodes py.language-data pywikiapi yaplon
    ];
    doCheck = false;
    pythonImportsCheck = [ "wiktra" ];
    meta.license = lib.licenses.mit;
  };

  # The UD<->SUD conversion grammars — surfacesyntacticud/tools, pinned to the same commit
  # THIRD-PARTY-NOTICES.md records (see app/grammars.py's own header for the full account of why
  # this is fetched rather than vendored: no declared upstream licence, so shipping a copy in this
  # repo or any built package would republish someone else's work without a grant to). Fetched
  # HERMETICALLY here, at the user's own `nix build`/`nix-build` time, from the ORIGINAL upstream —
  # not from anything this project hosts — which is the Nix-native equivalent of every OTHER
  # platform's "fetch onto the user's own machine, on demand, from inside the running app"
  # (app/grammars.py, an extras tier next to app/macron.py's identically-shaped Latin-macron
  # fetch). Two subtrees, not one — `converter/grs/` (the .grs grammars + their utils/lexicons
  # siblings) and `validator/modules/` (a SEPARATE top-level directory upstream, confirmed against
  # the real tree rather than assumed) — matching exactly what app/grammars.py fetches and what the
  # old vendored `grammars/` directory used to carry (~450 KB, 61 files as it did before).
  # Named separately from the fetcher call below, rather than read back off grammarsSrc.rev
  # (fetchFromGitHub's passthru attributes aren't a contract worth depending on): this is the one
  # source of truth for "which commit", used both to fetch it and to stamp the sentinel file
  # app/grammars.py's available() checks — matching app/grammars.py's own _REV constant exactly.
  _grammarsRev = "03c3bbd88e33a0f6331b58d0669edf1031aa9efb";

  grammarsSrc = pkgs.fetchFromGitHub {
    owner = "surfacesyntacticud";
    repo = "tools";
    rev = _grammarsRev;
    hash = "sha256-z4Tav5PpUDuQqwUFOMDmhmHsOiqtpG+b109bfVIryjg=";   # reported by a real `nix build`
                                                                    # against this exact rev, same as
                                                                    # wiktra's own fetchgit hash above.
  };

  # ── the full CORE runtime closure, mirroring requirements-core.txt line for line ──────
  coreDeps = [
    pywebview py.pygobject3 py.pycairo conllu
    py.spacy py.click enSudEwtGum
    grewpy
    wiktra
    py.requests py.beautifulsoup4 py.pypinyin
    aksharamukha indic-transliteration toJyutping openccPythonReimplemented
    hangul-romanize uroman
    py.fasttext   # substitutes fasttext-wheel==0.9.2 — see file header
  ];

  # RUNTIME TOOLING — deliberately a separate list from coreDeps, because nothing in `app/`
  # imports it. `pip` is here so a Nix user can DOWNLOAD PARSER MODELS (Manage Models →
  # `models_registry.download` → `sys.executable -m pip install --target $XDG_DATA_HOME/SUD
  # Workbench/site-packages <wheel>`) and install the on-demand tiers, neither of which this
  # closure pre-builds. See "MODELS ARE DOWNLOADABLE HERE" in the file header for the measurement
  # behind it and for why a separate `python312Packages.pip` in a `nix shell` is not the same
  # thing. Just `pip`, not `setuptools`/`wheel` alongside it: every model asset and every
  # declared requirement this app installs is a WHEEL, which pip unpacks with no build backend at
  # all, and pip's own build isolation fetches setuptools itself for the one `git+` spec in the
  # `stanza` tier — so pinning build tools here would be adding closure for a case that is either
  # already handled or already out of scope.
  runtimeTools = [ py.pip ];

  sud-workbench = py.buildPythonApplication {
    pname = "sud-workbench";
    version = "0.1.0";   # app/__init__.py's __version__

    # format="other": this project has no setup.py/pyproject.toml at all (it's `python -m
    # app`, run in place — see CLAUDE.md's "Commands" section and every other packaging
    # track's launcher, which all do the same `PYTHONPATH=<src> python -m app`). Rather than
    # invent packaging metadata upstream doesn't have, this derivation just places `app/` and
    # `web/` under one Nix store directory (siblings, as WEB_DIR's own `Path(__file__).resolve()
    # .parent.parent / "…"` computation expects) and writes a tiny launcher. `grammars/` is NOT
    # among these — it's `grammarsSrc` above, copied to its own store path below and pointed at
    # via the launcher's SUD_GRAMMARS_DIR (see app/paths.py), not a sibling of app/ any more.
    format = "other";
    dontBuild = true;

    src = ./.;

    nativeBuildInputs = [ pkgs.gobject-introspection pkgs.wrapGAppsHook3 ];
    # buildInputs, not propagatedBuildInputs: these are system libraries wrapGAppsHook3 scans
    # to compute GI_TYPELIB_PATH/XDG_DATA_DIRS/etc. on the wrapped executable — the same
    # shape as nixpkgs' own pkgs/by-name/py/pytrainer/package.nix (a real, GTK3+webkitgtk_4_1
    # Python app, read directly rather than reconstructed from general packaging folklore).
    buildInputs = [
      pkgs.gtk3 pkgs.webkitgtk_4_1 pkgs.glib-networking pkgs.gdk-pixbuf pkgs.adwaita-icon-theme
    ];

    propagatedBuildInputs = coreDeps ++ runtimeTools;

    # Heredoc body below (the LAUNCHER block) is deliberately flush against the left margin,
    # not indented to match the surrounding Nix source — see the historical note on flake.nix
    # (unchanged reasoning, this is the same installPhase moved verbatim).
    installPhase = ''
      runHook preInstall

      # app/, web/ as siblings — NOT vendor/ (the grew OCaml backend; genuinely optional, see
      # CLAUDE.md and grewpy's own meta.longDescription above), NOT samples/ (CLAUDE.md: "nothing
      # at runtime reads it"), NOT packaging/ (build-time only), and NOT grammars/ (see below —
      # fetched separately, into its own store path, not copied here). Mirrors exactly what
      # packaging/make_bootstrap_app.sh copies, minus the size-driven font/kit stripping that
      # script does for a *distributable bundle* — irrelevant to a Nix build, and stripping
      # web/win11-kit would be presuming an answer to a question this derivation doesn't touch:
      # which chrome kit a real Linux user agent should load is web/index.html's own call (a
      # third "linux"->adwaita-kit branch already exists there; see its own inline comment), not
      # this derivation's to prejudge by deleting the alternative.
      install -d "$out/lib/sud-workbench"
      cp -r app web "$out/lib/sud-workbench/"
      find "$out/lib/sud-workbench" -name '__pycache__' -type d -prune -exec rm -rf {} +

      # The two subtrees app/grammars.py's own on-demand fetch pulls from surfacesyntacticud/tools
      # on every OTHER platform — copied here from grammarsSrc (fetched hermetically above) into
      # their own store path, laid out IDENTICALLY to what that fetch produces under APP_DATA
      # (.grs files + utils/ + lexicons/ at the root, validator/modules/ alongside), sentinel file
      # included — so app/grammars.py's available() (a plain "does the sentinel match _REV" check)
      # reports true here with NO Nix-specific branch in the Python code at all; only the
      # SUD_GRAMMARS_DIR env var below tells the app to look at this store path instead of
      # APP_DATA/grammars.
      install -d "$out/share/sud-workbench-grammars/validator"
      cp -r "${grammarsSrc}/converter/grs/." "$out/share/sud-workbench-grammars/"
      cp -r "${grammarsSrc}/validator/modules" "$out/share/sud-workbench-grammars/validator/modules"
      printf '%s' "${_grammarsRev}" > "$out/share/sud-workbench-grammars/.sud-grammars-rev"

      install -d "$out/bin"
      cat > "$out/bin/sud-workbench" <<LAUNCHER
#!${python3.interpreter}
# Generated launcher — mirrors packaging/make_bootstrap_app.sh's own run_app() shape (PYTHONPATH
# set to the directory containing app/, cwd unimportant since WEB_DIR resolves off __file__, not
# cwd) but as a Python shebang script rather than a shell one, so buildPythonApplication's own
# postFixup (wrapPythonPrograms) finds it under \$out/bin and wraps it with propagatedBuildInputs'
# PYTHONPATH automatically — the standard mechanism, not reimplemented by hand here.
#
# SUD_GRAMMARS_DIR points app/paths.py's GRAMMARS_DIR at the copy fetched hermetically above,
# instead of the APP_DATA location every other platform's on-demand app/grammars.py fetch uses —
# see app/paths.py's own comment on this variable for why Nix gets its own escape hatch here.
import os, sys
os.environ.setdefault("SUD_GRAMMARS_DIR", "$out/share/sud-workbench-grammars")
sys.path.insert(0, "$out/lib/sud-workbench")
from app.__main__ import main
sys.exit(main())
LAUNCHER
      chmod +x "$out/bin/sud-workbench"

      runHook postInstall
    '';

    # No test suite to run (format=other skips the standard phases entirely); the real
    # verification is `pythonImportsCheck` below plus each hand-packaged dep's own, plus the
    # headless-Chrome/real-boot smoke tests CLAUDE.md's "Verification" section already
    # prescribes for THIS app, run against the built package rather than reimplemented here.
    # NOT "grewpy" here, for the exact reason given beside that package's own definition above
    # (a bare `import grewpy` spawns the deliberately-absent `grewpy_backend` binary and raises
    # `FileNotFoundError` — confirmed live: this exact line failed the WHOLE app's build with
    # that traceback, one indirection further out, until "grewpy" was dropped from this list).
    doCheck = false;
    pythonImportsCheck = [ "webview" "spacy" "wiktra" ];

    meta = {
      description = "Desktop editor for SUD/UD/mSUD dependency treebanks in CoNLL-U (Linux/GTK3 build)";
      homepage = "https://github.com/skalyan91/sud-workbench";
      license = lib.licenses.mit;
      platforms = [ "x86_64-linux" "aarch64-linux" ];
      mainProgram = "sud-workbench";
    };
  };
in
  if !spacyOk then
    throw ''
      sud-workbench needs python3Packages.spacy in the range [3.8.14, 3.9.0) — this nixpkgs has
      ${py.spacy.version}. Pin your channel/config to (or newer than) nixpkgs commit
      a769e26b6c0948d1b5b4e9f52533f49110a1e795 (the revision this was verified against), or wait
      for your channel to reach a nixpkgs commit whose spaCy falls in that range. A flake user
      (nix build via this repo's flake.nix) does not hit this — flake.lock pins it exactly.
    ''
  else
    sud-workbench
