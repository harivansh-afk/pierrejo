# pierrejo

<img width="full" height="full" alt="image" src="https://github.com/user-attachments/assets/c580bd48-a67a-498b-b914-5aa19d1decc4" />

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

The patches live in patches/forgejo-16/ and currently build against Forgejo 16.0.3. The box.tmpl override tracks the v16 review-comment placement rework: new-comment URLs carry before_commit_id/after_commit_id, and existing multi-line (shift+click) review threads render at their anchor row inside Pierre diffs with the native "Lines X-Y" label. Starting a NEW multi-line selection from the Pierre gutter is not yet supported (single-line comments work as before); it needs range selection in the upstream @pierre/diffs gutter UI.

## In-place diff editing

PR diffs are editable in place via @pierre/diffs 1.3 edit mode
(https://diffs.com/edit). Each editable file in a PR gets an "Edit inline"
button next to Forgejo's native "Edit this file" link, shown under the same
conditions (head branch editable, not deleted/LFS/binary/submodule). Clicking
it turns the rendered diff into a live editor:

- The editor chunk (@pierre/diffs/edit) is lazy-loaded on first use.
- Partial patch diffs hydrate to full file contents through Forgejo's raw
  endpoints (`/raw/commit/<sha>/<path>`) before edits apply, so commits always
  carry the complete file. This wiring also enables hunk context expansion.
- "Commit" posts through Forgejo's native `_edit` form flow (session auth,
  `last_commit` conflict detection, default commit email) directly to the PR
  head branch, then reloads the page. A stale head (someone pushed meanwhile)
  surfaces Forgejo's own edit-conflict error in the toolbar instead of
  committing.
- "Cancel" discards the session; if the document changed, the page reloads to
  restore the server-rendered diff.

Edit mode requires a browser with `Intl.Segmenter` (Chrome/Edge 123+,
Safari 17.5+, Firefox 125+ per the @pierre/diffs 1.3 baseline).

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
