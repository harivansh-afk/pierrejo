import dark from "./themes/cozybox-dark.json" with { type: "json" };
import light from "./themes/cozybox-light.json" with { type: "json" };

// The diff theme is the bundled Pierre/Shiki theme (default: cozybox). Theme
// names are read from each file's `name` field so the JSON can be swapped (e.g.
// via the Nix `theme` argument to mkPierreForgejo) without touching this code.
export const pierreThemes = { dark, light };
export const pierreThemeNames = { dark: dark.name, light: light.name };
