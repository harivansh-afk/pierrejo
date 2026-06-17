// Behaviour for the server-rendered diff file tree (the default sidebar).
//
// The tree markup is emitted by box.tmpl (PierreDiffFileTree) so it paints with
// the diffs instead of being built client-side by Forgejo's Vue component
// (which lazy-loads a chunk and always trails the SSR'd diffs). We disable that
// Vue mount, so this module reimplements the few behaviours it provided:
// collapsing directories, highlighting the file that matches the URL hash and
// expanding its (folded) diff box, and the show/hide-tree toggle button.

const TREE_SELECTOR = '#diff-file-tree[data-pierre-forgejo-ssr-tree="1"]';
const TOGGLE_SELECTOR = ".diff-toggle-file-tree-button";
const STORAGE_KEY = "diff_file_tree_visible";

let tree = null;
let abortController = null;

function expandDiffBox(hash) {
  const box = hash ? document.querySelector(hash) : null;
  if (!box || box.getAttribute("data-folded") !== "true") return;

  const foldButton = box.querySelector(".fold-file");
  if (typeof window._pierreSetFileFolding === "function") {
    window._pierreSetFileFolding(box, foldButton, false);
  } else if (foldButton instanceof HTMLElement) {
    foldButton.click();
  } else {
    box.setAttribute("data-folded", "false");
  }
}

function selectFromHash() {
  if (!tree) return;
  const hash = window.location.hash;
  let selected = null;
  for (const item of tree.querySelectorAll(".item-file")) {
    const match = hash.length > 1 && item.getAttribute("href") === hash;
    item.classList.toggle("selected", match);
    if (match) selected = item;
  }
  if (selected) {
    expandDiffBox(hash);
    selected.scrollIntoView({ block: "nearest" });
  }
}

function onTreeClick(event) {
  const directory = event.target.closest(".item-directory");
  if (directory && tree.contains(directory)) {
    directory.classList.toggle("pierre-collapsed");
  }
}

function setVisible(visible) {
  tree.classList.toggle("tw-hidden", !visible);

  const button = document.querySelector(TOGGLE_SELECTOR);
  if (button) {
    const [toShow, toHide] = button.querySelectorAll(".icon");
    toShow?.classList.toggle("tw-hidden", visible);
    toHide?.classList.toggle("tw-hidden", !visible);
    button.setAttribute(
      "data-tooltip-content",
      button.getAttribute(visible ? "data-hide-text" : "data-show-text"),
    );
  }

  try {
    localStorage?.setItem(STORAGE_KEY, String(visible));
  } catch {
  }
}

function toggleVisibility() {
  setVisible(tree.classList.contains("tw-hidden"));
}

export function hydratePierreNativeTree() {
  abortController?.abort();
  abortController = null;

  tree = document.querySelector(TREE_SELECTOR);
  if (!tree) return;

  abortController = new AbortController();
  const { signal } = abortController;

  tree.addEventListener("click", onTreeClick, { signal });
  document
    .querySelector(TOGGLE_SELECTOR)
    ?.addEventListener("click", toggleVisibility, { signal });
  window.addEventListener("hashchange", selectFromHash, { signal });

  selectFromHash();
}

document.addEventListener("turbo:before-cache", () => {
  abortController?.abort();
  abortController = null;
  tree = null;
});
