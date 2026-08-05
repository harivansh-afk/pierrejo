import { getDiffInstance, viewAnnotationsForPlaceholder } from "./pr-store.js";

// Per-placeholder edit session: { editor, detach, dirty, toolbar, button }
const sessions = new WeakMap();

let editorModulePromise;
function loadEditorModule() {
  // Lazy-loads the @pierre/diffs/edit chunk only when someone clicks Edit.
  editorModulePromise ??= import("@pierre/diffs/edit");
  return editorModulePromise;
}

function encodePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function fetchRawFile(base, path) {
  const response = await fetch(`${base}/${encodePath(path)}`, {
    credentials: "same-origin",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (!response.ok) throw new Error(`raw file request failed: ${response.status}`);
  return response.text();
}

// FileDiff calls this (via the loadDiffFiles option) to upgrade a partial
// patch-parsed diff to full file contents; it also runs automatically when an
// editor attaches to a partial diff (FileDiff.attachEditor ->
// loadFilesIfNecessary). Only 'change' and 'rename-changed' diffs are
// hydratable by the library, so oldFile is always fetchable here.
export function makeContentsLoader(placeholder) {
  const rawBase = placeholder.dataset.pierreForgejoRawBase;
  const rawHead = placeholder.dataset.pierreForgejoRawHead;
  if (!rawBase || !rawHead) return undefined;

  return async (fileDiff) => {
    const oldName = fileDiff.prevName ?? fileDiff.name;
    const [oldContents, newContents] = await Promise.all([
      fetchRawFile(rawBase, oldName),
      fetchRawFile(rawHead, fileDiff.name),
    ]);
    return {
      oldFile: { name: oldName, contents: oldContents },
      newFile: { name: fileDiff.name, contents: newContents },
    };
  };
}

// Editing needs the complete new-side file as the editor document; the
// renderer refuses document changes while fileDiff.isPartial. 'change' and
// 'rename-changed' diffs hydrate in place through loadDiffFiles; 'new' files
// are not hydratable by the library, so re-render them from full file input.
async function ensureEditableContents(placeholder, state) {
  const { instance, fileDiff } = state;
  if (!fileDiff) throw new Error("diff metadata unavailable");
  if (fileDiff.isPartial === false) return;

  if (fileDiff.type === "new") {
    const rawHead = placeholder.dataset.pierreForgejoRawHead;
    if (!rawHead) throw new Error("raw content URL unavailable");
    const contents = await fetchRawFile(rawHead, fileDiff.name);
    instance.render({
      oldFile: null,
      newFile: { name: fileDiff.name, contents },
      fileContainer: placeholder,
      lineAnnotations: viewAnnotationsForPlaceholder(placeholder),
    });
    state.fileDiff = instance.fileDiff;
    return;
  }

  // Kick the library's own hydration path and wait for it to finish
  // (hydratePartialDiff flips isPartial to false before the promise settles).
  instance.loadFilesIfNecessary();
  const pending = instance.pendingFiles?.promise;
  if (pending) await pending;
  if (state.fileDiff.isPartial !== false) {
    throw new Error("full file contents unavailable for editing");
  }
}

function findHeaderActions(placeholder) {
  const box = placeholder.closest(".diff-file-box");
  return box?.querySelector(".diff-file-header-actions") ?? null;
}

function setNotice(toolbar, message, isError) {
  const notice = toolbar.querySelector(".pierre-forgejo-edit-notice");
  if (!notice) return;
  notice.textContent = message ?? "";
  notice.classList.toggle("error", Boolean(isError));
}

function buildToolbar(placeholder, button) {
  const toolbar = document.createElement("span");
  toolbar.className = "pierre-forgejo-edit-toolbar";

  const notice = document.createElement("span");
  notice.className = "pierre-forgejo-edit-notice";

  const summary = document.createElement("input");
  summary.type = "text";
  summary.className = "pierre-forgejo-edit-summary";
  summary.maxLength = 100;
  summary.placeholder = `Update ${placeholder.dataset.pierreForgejoFile}`;

  const save = document.createElement("button");
  save.type = "button";
  save.className = "ui primary tiny button pierre-forgejo-edit-save";
  save.textContent = "Commit";
  save.addEventListener("click", () => {
    void saveEdit(placeholder, button, summary.value.trim());
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ui basic tiny button pierre-forgejo-edit-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    void exitEdit(placeholder, button, { restore: true });
  });

  toolbar.append(notice, summary, save, cancel);
  return toolbar;
}

async function enterEdit(placeholder, button) {
  const state = getDiffInstance(placeholder);
  if (!state?.instance) return;

  button.disabled = true;
  try {
    const [{ Editor }] = await Promise.all([
      loadEditorModule(),
      ensureEditableContents(placeholder, state),
    ]);

    const session = { editor: null, detach: null, dirty: false, toolbar: null, button };
    session.editor = new Editor({
      onChange: () => {
        session.dirty = true;
      },
    });
    session.detach = session.editor.edit(state.instance);

    const actions = findHeaderActions(placeholder);
    session.toolbar = buildToolbar(placeholder, button);
    if (actions) actions.prepend(session.toolbar);

    sessions.set(placeholder, session);
    button.classList.add("tw-hidden");
  } catch (error) {
    console.warn("Pierre edit mode failed to start", error);
    button.title = "Editing unavailable for this file";
  } finally {
    button.disabled = false;
  }
}

async function exitEdit(placeholder, button, { restore }) {
  const session = sessions.get(placeholder);
  if (!session) return;
  sessions.delete(placeholder);

  try {
    session.detach?.();
    session.editor?.cleanUp();
  } catch (error) {
    console.warn("Pierre editor detach failed", error);
  }
  session.toolbar?.remove();
  button.classList.remove("tw-hidden");

  if (restore && session.dirty) {
    // The edit session mutated the FileDiff document in place; the only
    // reliable way back to the server-side diff is a re-render from a fresh
    // fetch. Reload keeps native Forgejo state (viewed files, comments)
    // consistent too.
    window.location.reload();
  }
}

function formErrorMessage(html) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const flash = doc.querySelector(".flash-error .flash-error-content, .flash-error, .ui.negative.message");
    const text = flash?.textContent.trim();
    if (text) return text;
  } catch {
  }
  return "commit failed";
}

async function saveEdit(placeholder, button, summary) {
  const session = sessions.get(placeholder);
  const state = getDiffInstance(placeholder);
  if (!session || !state?.instance) return;

  if (state.fileDiff?.isPartial !== false) {
    setNotice(session.toolbar, "still loading file contents, try again", true);
    return;
  }

  const editUrl = placeholder.dataset.pierreForgejoEditUrl;
  if (!editUrl) {
    setNotice(session.toolbar, "editing not permitted", true);
    return;
  }

  const saveButton = session.toolbar.querySelector(".pierre-forgejo-edit-save");
  saveButton.disabled = true;
  setNotice(session.toolbar, "committing...", false);

  try {
    const content = session.editor.getText();

    // Fetch Forgejo's native _edit form to pick up the full commit form state
    // (last_commit for conflict detection, tree_path, commit_mail_id default,
    // page_has_posted) and post back through the same endpoint, exactly like
    // the native editor would.
    const formResponse = await fetch(editUrl, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!formResponse.ok) throw new Error(`edit form request failed: ${formResponse.status}`);
    const doc = new DOMParser().parseFromString(await formResponse.text(), "text/html");
    const form = doc.querySelector("form.ui.edit.form");
    if (!form) throw new Error("native edit form not found (no edit permission?)");

    const body = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === "string") body.set(key, value);
    }
    body.set("content", content);
    body.set("commit_choice", "direct");
    body.delete("new_branch_name");
    if (summary) body.set("commit_summary", summary);
    // No CSRF token: Forgejo 16 validates cross-origin writes via the
    // Sec-Fetch-Site header, which same-origin fetch() sets automatically.

    const response = await fetch(editUrl, {
      method: "POST",
      credentials: "same-origin",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const responseText = await response.text();
    const landedOnEditor = new URL(response.url, window.location.href).pathname.includes("/_edit/");
    if (!response.ok || landedOnEditor) {
      throw new Error(formErrorMessage(responseText));
    }

    // Commit landed on the head branch; the PR diff is stale now, reload to
    // pick up the new AfterCommitID, comments placement, and SSR render.
    window.location.reload();
  } catch (error) {
    console.warn("Pierre edit commit failed", error);
    setNotice(session.toolbar, error.message ?? "commit failed", true);
    saveButton.disabled = false;
  }
}

// Called from diff-view after a placeholder hydrates. Reveals the Edit button
// rendered by box.tmpl (kept hidden until the diff is interactive) and wires
// the toggle.
export function wireEditButton(placeholder) {
  if (!placeholder.dataset.pierreForgejoEditUrl) return;
  const box = placeholder.closest(".diff-file-box");
  const button = box?.querySelector(".pierre-forgejo-edit-toggle");
  if (!button || button.dataset.pierreWired === "1") return;
  button.dataset.pierreWired = "1";
  button.classList.remove("tw-hidden");
  button.addEventListener("click", () => {
    if (sessions.has(placeholder)) return;
    void enterEdit(placeholder, button);
  });
}
