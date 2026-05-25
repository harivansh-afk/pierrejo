{
  description = "Pierre diffs for Forgejo";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
      forSystems = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in
    {
      packages = forSystems (
        pkgs:
        let
          pierrejo = import ./nix/pierre-forgejo.nix {
            inherit pkgs;
            sourceRoot = self.outPath;
          };
        in
        {
          default = pierrejo.frontend;
          assets = pierrejo.assets;
          frontend = pierrejo.frontend;
          ssr = pierrejo.ssrPackage;
        }
      );

      checks = forSystems (
        pkgs:
        let
          pierrejo = import ./nix/pierre-forgejo.nix {
            inherit pkgs;
            sourceRoot = self.outPath;
          };
        in
        {
          assets = pierrejo.assets;
          frontend = pierrejo.frontend;
          ssr = pierrejo.ssrPackage;
        }
      );

      formatter = forSystems (pkgs: pkgs.nixfmt-tree);

      nixosModules = {
        default = ./nix/pierre-ssr.nix;
        pierre-ssr = ./nix/pierre-ssr.nix;
      };

      lib.mkPierreForgejo =
        {
          pkgs,
          sourceRoot ? self.outPath,
        }:
        import ./nix/pierre-forgejo.nix { inherit pkgs sourceRoot; };
    };
}
