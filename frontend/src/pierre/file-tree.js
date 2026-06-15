import { FileTree } from "@pierre/trees";
import { forgejoThemeType } from "./options.js";
import { treeUnsafeCss } from "./tree-theme.js";

// Wrapper element id from box.tmpl. Deliberately NOT "diff-file-tree" so
// Forgejo's native initDiffFileTree() (getElementById('diff-file-tree')) bails
// and never mounts its Vue tree over ours.
const CONTAINER_ID = "pierre-diff-file-tree";

// Pierre FileTree instance id. Must match the id the Go PierreFileTree helper
// sends to the sidecar (so SSR sets <file-tree-container id="pierre-file-tree">
// and FileTree.hydrate() attaches to it). Also must not be "diff-file-tree".
const TREE_ID = "pierre-file-tree";

// Forgejo DiffFileType (services/gitdiff): 1 add, 2 change, 3 delete,
// 4 rename, 5 copy. Pierre has no "copied" status; a copy is a new file.
const DIFF_TYPE_STATUS = {
  1: "added",
  2: "modified",
  3: "deleted",
  4: "renamed",
  5: "added",
};

let diffTree = null;
let diffTreeState = null;
let diffTreeWired = false;
// Guard so programmatic selection (from a hashchange) does not loop back into
// navigation through onSelectionChange.
let suppressSelection = false;

// Read the file list straight from the diff-file-box DOM. box.tmpl emits
// data-new-filename, data-pierre-type and id="diff-<NameHash>" on each box, so
// this is correct both on first paint and after "load more files" injects new
// boxes (no dependency on diffFileInfo reactivity / timing).
function collectDiffFiles() {
  const boxes = document.querySelectorAll("#diff-file-boxes .diff-file-box[data-new-filename]");
  const paths = [];
  const gitStatus = [];
  const anchorByPath = new Map();
  const pathByAnchor = new Map();
  for (const box of boxes) {
    const path = box.dataset.newFilename;
    if (!path || anchorByPath.has(path)) continue;
    paths.push(path);
    const status = DIFF_TYPE_STATUS[Number(box.dataset.pierreType)];
    if (status) gitStatus.push({ path, status });
    if (box.id) {
      const anchor = "#" + box.id;
      anchorByPath.set(path, anchor);
      pathByAnchor.set(anchor, path);
    }
  }
  return { paths, gitStatus, anchorByPath, pathByAnchor, fileSet: new Set(paths) };
}

function hashPath() {
  const hash = window.location.hash;
  return hash && diffTreeState?.pathByAnchor.has(hash) ? diffTreeState.pathByAnchor.get(hash) : null;
}

// Expand a folded diff box, like the native DiffFileTree did. nixpkgs builds
// Forgejo's own JS from unpatched source, so we cannot rely on a patched-in
// window._pierreSetFileFolding; replicate the unfold directly on the DOM.
// Forgejo's CSS reveals .diff-file-body when the box's data-folded != "true";
// we also flip the chevron icon by cloning a "down" chevron from any already
// expanded fold button (avoids hardcoding the octicon SVG).
function expandDiffBox(anchor) {
  if (!anchor) return;
  const box = document.querySelector(anchor);
  if (!box || box.getAttribute("data-folded") !== "true") return;
  box.setAttribute("data-folded", "false");
  const fold = box.querySelector(".fold-file");
  const downChevron = document.querySelector('.diff-file-box:not([data-folded="true"]) .fold-file > svg');
  if (fold && downChevron) fold.innerHTML = downChevron.outerHTML;
}

function onTreeSelection(paths) {
  if (suppressSelection || !diffTreeState) return;
  // Only navigate for file rows; ignore directory selection.
  const path = [...paths].reverse().find((p) => diffTreeState.fileSet.has(p));
  if (!path) return;
  const anchor = diffTreeState.anchorByPath.get(path);
  if (!anchor) return;
  expandDiffBox(anchor);
  if (window.location.hash !== anchor) {
    window.location.hash = anchor; // native scroll to the file box
  } else {
    document.querySelector(anchor)?.scrollIntoView();
  }
}

function selectFromHash() {
  if (!diffTree) return;
  const path = hashPath();
  if (!path) return;
  suppressSelection = true;
  try {
    diffTree.getItem(path)?.select();
    diffTree.scrollToPath(path, { focus: false });
  } catch (error) {
    console.warn("Pierre file tree selection failed", error);
  } finally {
    suppressSelection = false;
  }
  expandDiffBox(diffTreeState.anchorByPath.get(path));
}

function toggleElem(el, show) {
  el?.classList.toggle("tw-hidden", !show);
}

function setDiffTreeVisible(visible) {
  const tree = document.getElementById(CONTAINER_ID);
  const btn = document.querySelector(".diff-toggle-file-tree-button");
  if (!tree || !btn) return;
  const [toShow, toHide] = btn.querySelectorAll(".icon");
  btn.setAttribute("data-tooltip-content", btn.getAttribute(visible ? "data-hide-text" : "data-show-text"));
  toggleElem(tree, visible);
  toggleElem(toShow, !visible);
  toggleElem(toHide, visible);
  try {
    localStorage?.setItem("diff_file_tree_visible", String(visible));
  } catch {
    // ignore storage failures
  }
  // The virtualizer needs layout, so defer first hydration until the tree is
  // actually visible.
  if (visible) mountDiffTree();
}

function isVisible(el) {
  return !el.classList.contains("tw-hidden") && el.offsetParent !== null;
}

function mountDiffTree() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container || container.dataset.pierreForgejoFileTree !== "1") return;
  if (container.dataset.pierreForgejoHydrated === "1") return;
  if (!isVisible(container)) return; // hydrate later, on first reveal

  const state = collectDiffFiles();
  if (state.paths.length === 0) return;

  // Options here must match ssr/server.js treeOptions exactly (minus the
  // non-serializable onSelectionChange) so hydration does not re-flow.
  const options = {
    id: TREE_ID,
    paths: state.paths,
    gitStatus: state.gitStatus,
    initialExpansion: "open",
    initialVisibleRowCount: 200,
    icons: { set: "standard", colored: true },
    unsafeCSS: treeUnsafeCss(forgejoThemeType()),
    onSelectionChange: onTreeSelection,
  };

  try {
    const instance = new FileTree(options);
    const host = container.querySelector("file-tree-container");
    if (host) {
      instance.hydrate({ fileTreeContainer: host });
    } else {
      // Sidecar produced no SSR markup: mount client-side instead.
      const el = document.createElement("file-tree-container");
      container.appendChild(el);
      instance.render({ fileTreeContainer: el });
    }
    diffTree = instance;
    diffTreeState = state;
    container.dataset.pierreForgejoHydrated = "1";
    selectFromHash();
  } catch (error) {
    console.warn("Pierre file tree hydration failed", error);
  }
}

function wireDiffTree() {
  if (diffTreeWired) return;
  diffTreeWired = true;

  const btn = document.querySelector(".diff-toggle-file-tree-button");
  if (btn) {
    const visible = () => !document.getElementById(CONTAINER_ID)?.classList.contains("tw-hidden");
    btn.addEventListener("click", () => setDiffTreeVisible(!visible()));
  }

  window.addEventListener("hashchange", selectFromHash);

  // Keep the tree in sync when "load more files" appends new diff boxes.
  const boxes = document.getElementById("diff-file-boxes");
  if (boxes) {
    const observer = new MutationObserver(() => {
      if (!diffTree || !diffTreeState) return;
      const next = collectDiffFiles();
      if (next.paths.length === diffTreeState.paths.length) return;
      try {
        diffTree.resetPaths(next.paths); // keeps initialExpansion: "open"
        diffTree.setGitStatus(next.gitStatus);
      } catch (error) {
        console.warn("Pierre file tree resync failed", error);
        return;
      }
      diffTreeState = next;
      selectFromHash();
    });
    observer.observe(boxes, { childList: true });
  }
}

export function hydratePierreFileTrees() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container || container.dataset.pierreForgejoFileTree !== "1") return;
  wireDiffTree();
  mountDiffTree();
}
