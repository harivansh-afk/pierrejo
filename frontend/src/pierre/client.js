import * as pierreModule from "@pierre/diffs";
import { pierreThemeNames, pierreThemes } from "./theme.js";

let registered = false;
if (!registered) {
  pierreModule.registerCustomTheme(pierreThemeNames.dark, () => Promise.resolve(pierreThemes.dark));
  pierreModule.registerCustomTheme(pierreThemeNames.light, () => Promise.resolve(pierreThemes.light));
  registered = true;
}

export const pierre = pierreModule;
