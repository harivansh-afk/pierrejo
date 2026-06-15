import { FileTree } from "@pierre/trees";
import { forgejoThemeType } from "./options.js";
import { treeUnsafeCss } from "./tree-theme.js";

const CONTAINER_SELECTOR = '[data-pierre-forgejo-file-tree="1"]';
const TREE_ID = "pierre-file-tree";
const STORAGE_KEY = "diff_file_tree_visible";
const ACTIVE_FILE_TOP_OFFSET = 120;

const DIFF_TYPE_STATUS = {
  1: "added",
  2: "modified",
  3: "deleted",
  4: "renamed",
  5: "added",
};

let activeTree = null;

function diffFileInfo() {
  return window.config?.pageData?.diffFileInfo;
}

function collectFiles() {
  const files = Array.isArray(diffFileInfo()?.files) ? diffFileInfo().files : [];
  const paths = [];
  const gitStatus = [];
  const anchorByPath = new Map();
  const pathByAnchor = new Map();

  for (const file of files) {
    const path = file?.Name;
    const hash = file?.NameHash;
    if (!path || anchorByPath.has(path)) continue;

    paths.push(path);
    if (hash) {
      const anchor = `#diff-${hash}`;
      anchorByPath.set(path, anchor);
      pathByAnchor.set(anchor, path);
    }

    const status = DIFF_TYPE_STATUS[Number(file?.Type)];
    if (status) gitStatus.push({ path, status });
  }

  return {
    anchorByPath,
    fileSet: new Set(paths),
    gitStatus,
    paths,
    pathByAnchor,
    signature: paths.join("\0"),
  };
}

function selectedFilePath(paths, state) {
  return paths.length === 1 && state.fileSet.has(paths[0]) ? paths[0] : null;
}

function pathFromHash(state) {
  return state.pathByAnchor.get(window.location.hash) ?? null;
}

function pathFromDiffBox(state, box) {
  return box?.id ? state.pathByAnchor.get("#" + box.id) ?? null : null;
}

function expandDiffBox(anchor) {
  const box = anchor ? document.querySelector(anchor) : null;
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

function navigateToFile(controller, path) {
  const anchor = controller.state.anchorByPath.get(path);
  if (!anchor) return;

  expandDiffBox(anchor);
  if (window.location.hash === anchor) {
    document.querySelector(anchor)?.scrollIntoView();
  } else {
    window.location.hash = anchor;
  }
}

function selectTreePath(controller, path) {
  if (!path || !controller.tree) return false;

  controller.suppressSelection = true;
  try {
    for (const selected of controller.tree.getSelectedPaths()) {
      if (selected !== path) controller.tree.getItem(selected)?.deselect();
    }
    controller.tree.getItem(path)?.select();
    controller.tree.scrollToPath(path, { focus: false, offset: "nearest" });
    return true;
  } catch (error) {
    console.warn("Pierre file tree selection failed", error);
    return false;
  } finally {
    controller.suppressSelection = false;
  }
}

function selectFromHash(controller) {
  const path = pathFromHash(controller.state);
  if (!selectTreePath(controller, path)) return false;

  expandDiffBox(controller.state.anchorByPath.get(path));
  return true;
}

function activeDiffPath(controller) {
  const boxes = document.querySelectorAll(".diff-file-box[id]");
  let activePath = null;
  let firstVisiblePath = null;

  for (const box of boxes) {
    const path = pathFromDiffBox(controller.state, box);
    if (!path) continue;

    const rect = box.getBoundingClientRect();
    if (rect.height === 0 || rect.bottom <= 0) continue;
    if (firstVisiblePath === null && rect.top < window.innerHeight) firstVisiblePath = path;
    if (rect.top <= ACTIVE_FILE_TOP_OFFSET) activePath = path;
    else break;
  }

  return activePath ?? firstVisiblePath;
}

function syncSelectionFromScroll(controller) {
  if (!controller.tree || !isVisible(controller.container)) return;
  selectTreePath(controller, activeDiffPath(controller));
}

function scheduleScrollSelectionSync(controller) {
  if (controller.selectionFrame !== null) return;
  controller.selectionFrame = requestAnimationFrame(() => {
    controller.selectionFrame = null;
    syncSelectionFromScroll(controller);
  });
}

function toggleElement(el, show) {
  el?.classList.toggle("tw-hidden", !show);
}

function storedTreeVisible() {
  try {
    return localStorage?.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function setTreeVisible(controller, visible) {
  const [showIcon, hideIcon] = controller.button?.querySelectorAll(".icon") ?? [];
  controller.button?.setAttribute(
    "data-tooltip-content",
    controller.button.getAttribute(visible ? "data-hide-text" : "data-show-text"),
  );
  toggleElement(controller.container, visible);
  toggleElement(showIcon, !visible);
  toggleElement(hideIcon, visible);

  try {
    localStorage?.setItem(STORAGE_KEY, String(visible));
  } catch {
  }

  if (visible) mountTree(controller);
}

function isVisible(container) {
  return !container.classList.contains("tw-hidden") && container.offsetParent !== null;
}

function treeOptions(controller) {
  return {
    id: TREE_ID,
    paths: controller.state.paths,
    gitStatus: controller.state.gitStatus,
    flattenEmptyDirectories: true,
    presorted: true,
    initialExpansion: "open",
    initialVisibleRowCount: 200,
    icons: { set: "minimal", colored: false },
    unsafeCSS: treeUnsafeCss(forgejoThemeType()),
    onSelectionChange(paths) {
      if (controller.suppressSelection) return;
      const path = selectedFilePath(paths, controller.state);
      if (path) navigateToFile(controller, path);
    },
  };
}

function mountTree(controller) {
  if (controller.tree || !isVisible(controller.container)) return;

  controller.state = collectFiles();
  if (controller.state.paths.length === 0) return;

  const tree = new FileTree(treeOptions(controller));
  const host = controller.container.querySelector("file-tree-container");
  if (host) {
    tree.hydrate({ fileTreeContainer: host });
  } else {
    const fallbackHost = document.createElement("file-tree-container");
    controller.container.append(fallbackHost);
    tree.render({ fileTreeContainer: fallbackHost });
  }

  controller.tree = tree;
  controller.container.dataset.pierreForgejoHydrated = "1";
  if (!selectFromHash(controller)) syncSelectionFromScroll(controller);
}

function resyncTree(controller) {
  if (!controller.tree) return;

  const nextState = collectFiles();
  if (nextState.signature === controller.state.signature) return;

  try {
    controller.tree.resetPaths(nextState.paths);
    controller.tree.setGitStatus(nextState.gitStatus);
    controller.state = nextState;
    if (!selectFromHash(controller)) syncSelectionFromScroll(controller);
  } catch (error) {
    console.warn("Pierre file tree resync failed", error);
  }
}

function createController(container) {
  const abortController = new AbortController();
  const controller = {
    abortController,
    button: document.querySelector(".diff-toggle-file-tree-button"),
    container,
    selectionFrame: null,
    state: collectFiles(),
    suppressSelection: false,
    tree: null,
  };

  controller.button?.addEventListener(
    "click",
    () => setTreeVisible(controller, controller.container.classList.contains("tw-hidden")),
    { signal: abortController.signal },
  );
  window.addEventListener("hashchange", () => selectFromHash(controller), { signal: abortController.signal });
  window.addEventListener("scroll", () => scheduleScrollSelectionSync(controller), {
    passive: true,
    signal: abortController.signal,
  });
  window.addEventListener("resize", () => scheduleScrollSelectionSync(controller), {
    passive: true,
    signal: abortController.signal,
  });

  const boxes = document.getElementById("diff-file-boxes");
  if (boxes) {
    const observer = new MutationObserver(() => {
      resyncTree(controller);
      scheduleScrollSelectionSync(controller);
    });
    observer.observe(boxes, { childList: true });
    abortController.signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  }

  abortController.signal.addEventListener(
    "abort",
    () => {
      if (controller.selectionFrame !== null) cancelAnimationFrame(controller.selectionFrame);
    },
    { once: true },
  );

  return controller;
}

function cleanupActiveTree() {
  activeTree?.abortController.abort();
  activeTree?.tree?.cleanUp();
  activeTree = null;
}

export function hydratePierreFileTrees() {
  const container = document.querySelector(CONTAINER_SELECTOR);
  if (!container) return;

  if (activeTree?.container === container) {
    setTreeVisible(activeTree, storedTreeVisible());
    return;
  }

  cleanupActiveTree();
  activeTree = createController(container);
  setTreeVisible(activeTree, storedTreeVisible());
}

document.addEventListener("turbo:before-cache", cleanupActiveTree);
