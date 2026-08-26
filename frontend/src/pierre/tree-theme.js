import { themeToTreeStyles } from "@pierre/trees";
import { pierreThemes } from "./theme.js";

const TREE_CHROME_CSS =
  ':host{--trees-font-family-override:"Berkeley Mono",var(--fonts-monospace,ui-monospace,Menlo,monospace)}' +
  "button[data-item-type='folder'][data-item-contains-git-change] [data-item-section='git']{display:none}" +
  "button[data-item-git-status] > [data-item-section='content']{color:var(--trees-fg)}";

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
  const light = treeStyleDeclarations(themeToTreeStyles(treeThemeInput(pierreThemes.light, "light")));
  const dark = treeStyleDeclarations(themeToTreeStyles(treeThemeInput(pierreThemes.dark, "dark")));
  if (themeType === "dark") return ":host{" + dark + "}" + TREE_CHROME_CSS;
  if (themeType === "light") return ":host{" + light + "}" + TREE_CHROME_CSS;
  return ":host{" + light + "}@media (prefers-color-scheme:dark){:host{" + dark + "}}" + TREE_CHROME_CSS;
}
