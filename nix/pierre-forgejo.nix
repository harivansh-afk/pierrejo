{
  pkgs,
  sourceRoot ? ../.,
  theme ? null,
}:
let
  root =
    if builtins.isAttrs sourceRoot && sourceRoot ? outPath then sourceRoot.outPath else sourceRoot;

  withTheme =
    name: srcDir: themesRel:
    if theme == null then
      srcDir
    else
      pkgs.runCommand "pierrejo-${name}-themed-src" { } ''
        mkdir -p $out
        cp -R ${srcDir}/. $out/
        chmod -R u+w $out
        cp ${theme.dark} $out/${themesRel}/cozybox-dark.json
        cp ${theme.light} $out/${themesRel}/cozybox-light.json
      '';

  frontend = pkgs.buildNpmPackage {
    pname = "pierrejo-frontend";
    version = "0.1.0";
    src = withTheme "frontend" (root + "/frontend") "src/pierre/themes";
    npmDepsHash = "sha256-SnBULUSGc3cfNj5859QYVcSDSqvNku39BxwB6WVVeVs=";
    installPhase = ''
      runHook preInstall
      mkdir -p $out/js
      cp -R dist/. $out/js/
      runHook postInstall
    '';
    meta.license = pkgs.lib.licenses.asl20;
  };

  ssrPackage = pkgs.buildNpmPackage {
    pname = "pierrejo-ssr";
    version = "0.1.0";
    src = withTheme "ssr" (root + "/ssr") "themes";
    npmDepsHash = "sha256-zW4JKhUmyYfXcG3vD1/HlOLXKVwCAiMAnGsjLR6sKRs=";
    dontNpmBuild = true;
    nativeBuildInputs = [
      pkgs.makeWrapper
    ];
    installPhase = ''
      runHook preInstall
      mkdir -p $out/lib/pierrejo-ssr
      cp -R . $out/lib/pierrejo-ssr
      makeWrapper \${pkgs.nodejs}/bin/node $out/bin/pierre-ssr --add-flags $out/lib/pierrejo-ssr/server.js
      runHook postInstall
    '';
    meta.license = pkgs.lib.licenses.asl20;
  };

  corePatches = [
    (root + "/patches/forgejo-16.0.1/0001-pierre-ssr-highlighting.patch")
    (root + "/patches/forgejo-16.0.1/0002-expose-init-globals.patch")
    (root + "/patches/forgejo-16.0.1/0004-pierre-file-tree.patch")
  ];

  fileViewPatches = [
    (root + "/patches/forgejo-16.0.1/0003-pierre-file-view-highlighting.patch")
  ];

  patches = corePatches ++ fileViewPatches;

  patchBundledForgejoAssets = ''
    # Guard the native Vue diff-file-tree mount behind the pierre attributes in
    # the built bundle. The minified local name for the element ("We" on the
    # 15.0.2 build) changes between Forgejo releases, so match it with a
    # capture group instead of hard-coding it, then verify the guard landed.
    # The assets dir is copied out of the store read-only, and sed -i creates
    # its temp file next to the target, so make the dir and file writable first.
    chmod u+w "$data/public/assets/js" "$data/public/assets/js/index.js"
    sed -Ei \
      's/const ([A-Za-z_$][A-Za-z0-9_$]*)=document\.getElementById\("diff-file-tree"\);if\(!\1\)return;/const \1=document.getElementById("diff-file-tree");if(!\1||\1.getAttribute("data-pierre-forgejo-file-tree")==="1"||\1.getAttribute("data-pierre-forgejo-ssr-tree")==="1")return;/' \
      "$data/public/assets/js/index.js"
    grep -qE 'document\.getElementById\("diff-file-tree"\);if\(![A-Za-z0-9_$]+\|\|[A-Za-z0-9_$]+\.getAttribute\("data-pierre-forgejo-file-tree"\)' \
      "$data/public/assets/js/index.js" || {
      echo "pierrejo: diff-file-tree guard did not apply to bundled index.js" >&2
      exit 1
    }
  '';

  assets =
    pkgs.runCommand "pierrejo-forgejo-assets" { } ''
      mkdir -p $out/css
      cp \${root + "/assets/css/pierre-forgejo.css"} $out/css/pierre-forgejo.css
    ''
    // {
      meta.license = pkgs.lib.licenses.asl20;
    };
in
{
  inherit
    assets
    frontend
    patches
    ssrPackage
    ;

  nixosModule = root + "/nix/pierre-ssr.nix";
  templates = root + "/templates";

  mkForgejoWithPierre =
    arg:
    let
      mkWithOptions =
        {
          fileView ? false,
        }:
        forgejoPackage:
        forgejoPackage.overrideAttrs (old: {
          patches = (old.patches or [ ]) ++ corePatches ++ pkgs.lib.optionals fileView fileViewPatches;
          postInstall = (old.postInstall or "") + "\n" + patchBundledForgejoAssets;
        });
    in
    if pkgs.lib.isDerivation arg then mkWithOptions { } arg else mkWithOptions arg;
}
