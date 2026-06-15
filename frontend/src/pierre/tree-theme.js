import { themeToTreeStyles } from "@pierre/trees";
import cozyboxDark from "./themes/cozybox-dark.json" with { type: "json" };
import cozyboxLight from "./themes/cozybox-light.json" with { type: "json" };

// Convert a themeToTreeStyles() object into a CSS declaration list. camelCase
// keys (colorScheme, backgroundColor, ...) become kebab-case CSS properties;
// custom properties (--trees-theme-*) are emitted verbatim.
//
// This MUST stay byte-identical to ssr/server.js treeUnsafeCss so the SSR
// shadow DOM <style data-file-tree-unsafe-css> and the value we pass to
// FileTree.hydrate() match exactly and Pierre does not re-flow on hydrate.
function treeStyleDeclarations(styles) {
  return Object.entries(styles)
    .map(([key, value]) => {
      const property = key.startsWith("--") ? key : key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      return property + ":" + value;
    })
    .join(";");
}

function treeThemeInput(theme, type) {
  return {
    type,
    bg: theme.colors?.["editor.background"],
    fg: theme.colors?.["editor.foreground"],
    colors: theme.colors,
  };
}

export function treeUnsafeCss(themeType) {
  const light = treeStyleDeclarations(themeToTreeStyles(treeThemeInput(cozyboxLight, "light")));
  const dark = treeStyleDeclarations(themeToTreeStyles(treeThemeInput(cozyboxDark, "dark")));
  if (themeType === "dark") return ":host{" + dark + "}";
  if (themeType === "light") return ":host{" + light + "}";
  return ":host{" + light + "}@media (prefers-color-scheme:dark){:host{" + dark + "}}";
}
