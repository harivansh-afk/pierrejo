import { hydratePierreDiffs } from "./pierre/diff-view.js";
import { hydratePierreFileTrees } from "./pierre/file-tree.js";
import { hydratePierreNativeTree } from "./pierre/native-tree.js";

function init() {
  hydratePierreDiffs();
  hydratePierreFileTrees();
  hydratePierreNativeTree();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

document.addEventListener("turbo:load", init);
