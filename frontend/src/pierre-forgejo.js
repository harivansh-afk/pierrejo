import { hydratePierreDiffs } from "./pierre/diff-view.js";
import { hydratePierreFileTrees } from "./pierre/file-tree.js";

function init() {
  hydratePierreDiffs();
  hydratePierreFileTrees();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

document.addEventListener("turbo:load", init);
