/*
  SUD Workbench — flake wrapper around default.nix (Linux/NixOS only).

  ALL the actual package logic — nixpkgs dependency resolution, the spaCy doCheck/fixpoint
  rewiring, every hand-packaged PyPI wheel, the install phase — lives in ./default.nix, not here.
  This file exists ONLY to give flake users (`nix build`, `nix run`, `nix develop`) the exact,
  hermetic nixpkgs pin flake.lock provides; a non-flake caller (plain `nix-build default.nix`,
  `pkgs.callPackage ./default.nix {}`, a Home Manager config, an overlay, …) uses default.nix
  directly and gets IDENTICAL package logic against whatever nixpkgs THEY already have — see
  default.nix's own header for the full rationale, the one real trade-off of going non-flake
  (no automatic nixpkgs pin — default.nix asserts the one thing that actually matters, spaCy's
  version range, rather than silently trusting an unpinned channel), and Home Manager usage
  examples. If you don't use flakes, ignore this file entirely and read default.nix instead.
*/
{
  description = "SUD Workbench — SUD/UD/mSUD dependency-treebank editor (Linux/NixOS build). The real derivation is in default.nix, usable with or without flakes — see its header.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/a769e26b6c0948d1b5b4e9f52533f49110a1e795";
  };

  outputs = { self, nixpkgs }:
    let
      # NixOS/Nix is what this app's own native-shell dispatch (app/__main__.py's IS_LINUX branch,
      # app/linux/shell.py) targets; the two realistic desktop architectures are listed rather than
      # nixpkgs.lib.systems.flakeExposed's full cross-compilation matrix; darwin/windows are NOT
      # here on purpose (see default.nix's header) — app/mac and app/win exist for THOSE, unpackaged
      # by this derivation by design, not by omission.
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems f;
      pkgsFor = system: import nixpkgs { inherit system; };
      sudFor = system: (pkgsFor system).callPackage ./default.nix { };
    in
    {
      packages = forAllSystems (system: {
        default = sudFor system;
        sud-workbench = sudFor system;
      });

      # Hacking on the source directly: same runtime closure as the package, minus the
      # install/wrap step, for `nix develop` + `python -m app`.
      devShells = forAllSystems (system:
        let
          pkgs = pkgsFor system;
          sud = sudFor system;
        in
        {
          default = pkgs.mkShell {
            inputsFrom = [ sud ];
            packages = [ pkgs.python312 ];
            shellHook = ''
              echo "SUD Workbench dev shell (Linux/GTK3). Run:"
              echo "  python -m app [file.conllu]"
              echo "SUD_DEBUG=1 python -m app   # opens the WebKit inspector"
            '';
          };
        });
    };
}
