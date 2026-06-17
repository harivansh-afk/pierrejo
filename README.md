# pierrejo

Pierre diffs for Forgejo.

pierrejo packages the Forgejo integration layer for @pierre/diffs and @pierre/trees: a server-side rendering sidecar, the browser hydration bridge, Forgejo patches, and the template override needed to render Pierre diffs inside Forgejo pull request pages.

By default the diff file tree is Forgejo's own native Vue tree. The @pierre/trees
tree is opt-in (see "Diff file tree" below); when enabled the sidecar prerenders
it and pierre-forgejo.js hydrates the `data-pierre-forgejo-file-tree` markup.

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
      services.forgejo.package = pierrejo.mkForgejoWithPierre { } pkgs.forgejo-lts;

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

## Custom diff theme

By default diffs are highlighted with the bundled `cozybox` Shiki theme. To use
your own palette, pass `theme` to `mkPierreForgejo` with a dark and light
[Shiki/TextMate theme JSON](https://shiki.style/guide/load-theme) (the same
`{ name, type, colors, tokenColors }` shape as the bundled themes):

    let
      pierrejo = inputs.pierrejo.lib.mkPierreForgejo {
        inherit pkgs;
        theme = {
          dark = ./themes/midnight-dark.json;
          light = ./themes/midnight-light.json;
        };
      };

The Shiki theme name is read from each JSON's `name` field, so the frontend and
SSR sidecar stay in sync automatically. Omitting `theme` keeps the bundled
cozybox theme.

## File view highlighting

`mkForgejoWithPierre` takes an options set. By default Pierre renders only
diffs and leaves the single-file source viewer to Forgejo's native (Chroma)
highlighter, which respects Forgejo's theme and detects languages by
extension, shebang, and filename:

    services.forgejo.package = pierrejo.mkForgejoWithPierre { } pkgs.forgejo-lts;

Set `fileView = true` to also route the single-file viewer through Pierre's
Shiki tokenizer:

    services.forgejo.package =
      pierrejo.mkForgejoWithPierre { fileView = true; } pkgs.forgejo-lts;

Pierre's file-view output uses Shiki's dual-theme CSS variables
(`--shiki-light` / `--shiki-dark`), so enabling `fileView` requires the
consumer to ship CSS that consumes them, e.g.
`color: light-dark(var(--shiki-light), var(--shiki-dark))`; otherwise the
tokens render uncolored.

## Diff file tree

The diff file tree (the sidebar listing changed files on PR / commit diff
pages) uses Forgejo's native Vue tree by default. The @pierre/trees tree is
opt-in because it hydrates client-side and is slower to settle than the native
tree.

To opt in, set `PIERRE_FILE_TREE=true` in the Forgejo service environment (the
same place `PIERRE_SSR_SOCKET` is set):

    systemd.services.forgejo = {
      after = [ "pierre-ssr.service" ];
      wants = [ "pierre-ssr.service" ];
      environment = {
        PIERRE_SSR_SOCKET = "/run/pierre-ssr/pierre.sock";
        PIERRE_FILE_TREE = "true";
      };
    };

When unset (the default), `PierreFileTree` returns nothing and the template
renders Forgejo's native `#diff-file-tree`.
