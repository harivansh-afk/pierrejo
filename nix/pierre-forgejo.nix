{
  pkgs,
  sourceRoot ? ../.,
  # Optional custom diff theme. Set to { dark = <shiki-theme.json>; light =
  # <shiki-theme.json>; } to replace the bundled cozybox theme. The Shiki theme
  # name is read from each JSON's `name` field, so no other config is needed.
  # Defaults to null (the bundled cozybox theme).
  theme ? null,
}:
let
  root =
    if builtins.isAttrs sourceRoot && sourceRoot ? outPath then sourceRoot.outPath else sourceRoot;

  # When a custom theme is provided, return a copy of `srcDir` with the bundled
  # theme JSON replaced; otherwise return the source unchanged.
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
    npmDepsHash = "sha256-wIyJ3Af65p615GqhbxUbvetOlOTe1Rg75oYAsQnLvPA=";
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
    npmDepsHash = "sha256-fIj9bUjAYvnIe2o1IT9l9wr8tn1MtomNKb/dvLYfiGQ=";
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
    (root + "/patches/forgejo-15.0.2/0001-pierre-ssr-highlighting.patch")
    (root + "/patches/forgejo-15.0.2/0002-expose-init-globals.patch")
  ];

  fileViewPatches = [
    (root + "/patches/forgejo-15.0.2/0003-pierre-file-view-highlighting.patch")
  ];

  patches = corePatches ++ fileViewPatches;

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
    {
      fileView ? false,
    }:
    forgejoPackage:
    forgejoPackage.overrideAttrs (old: {
      patches = (old.patches or [ ]) ++ corePatches ++ pkgs.lib.optionals fileView fileViewPatches;
    });
}
