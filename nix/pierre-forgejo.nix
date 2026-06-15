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
    npmDepsHash = "sha256-ybqIh9Uj4plBOB4Xgjm9K9EgxnOyDwQ9kHEPzz6wVEU=";
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
    npmDepsHash = "sha256-+E01bAkiqIrN1hlr3Qsjvg2rveW1ofUBf83bBZGNcGM=";
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
    (root + "/patches/forgejo-15.0.2/0004-pierre-file-tree.patch")
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
