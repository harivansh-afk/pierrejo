# pierrejo

> [!IMPORTANT]
> This is a read-only mirror of <https://git.harivan.sh/harivansh-afk/pierrejo>. Use Forgejo for issues, pull requests, and active development.

Pierre diffs for Forgejo.

pierrejo packages the Forgejo integration layer for @pierre/diffs: a server-side rendering sidecar, the browser hydration bridge, Forgejo patches, and the diff template override needed to render Pierre diffs inside Forgejo pull request pages.

## Outputs

- packages.SYSTEM.frontend: the browser module exposing pierre-forgejo.js.
- packages.SYSTEM.ssr: the pierre-ssr sidecar executable.
- nixosModules.pierre-ssr: a NixOS module for services.pierre-ssr.
- lib.mkPierreForgejo: helper returning frontend, ssrPackage, templates, patches, and mkForgejoWithPierre.

## NixOS usage

    {
      inputs.pierrejo.url = "git+https://git.harivan.sh/harivansh-afk/pierrejo.git";
    }

    { inputs, pkgs, ... }:
    let
      pierrejo = inputs.pierrejo.lib.mkPierreForgejo { inherit pkgs; };
    in
    {
      imports = [ pierrejo.nixosModule ];

      services.pierre-ssr.enable = true;
      services.forgejo.package = pierrejo.mkForgejoWithPierre pkgs.forgejo-lts;

      systemd.services.forgejo = {
        after = [ "pierre-ssr.service" ];
        wants = [ "pierre-ssr.service" ];
        environment.PIERRE_SSR_SOCKET = "/run/pierre-ssr/pierre.sock";
      };
    }

The consumer must expose these files through Forgejo's custom directory:

- pierrejo.frontend / js / pierre-forgejo.js under custom/public/assets/js/pierre-forgejo.js
- pierrejo.templates / repo / diff / box.tmpl under custom/templates/repo/diff/box.tmpl

The current patches target Forgejo 15.0.2.