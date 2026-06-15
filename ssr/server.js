import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { registerCustomTheme } from "@pierre/diffs";
import { preloadPatchDiff } from "@pierre/diffs/ssr";
import { themeToTreeStyles } from "@pierre/trees";
import { preloadFileTree, serializeFileTreeSsrPayload } from "@pierre/trees/ssr";
import { createHighlighter, createJavaScriptRegexEngine } from "shiki";
import { pierreThemeNames, pierreThemes } from "./theme.js";

const socketPath = process.env.PIERRE_SSR_SOCKET ?? "/run/pierre-ssr/pierre.sock";
const cacheDir = process.env.PIERRE_SSR_CACHE_DIR ?? "/var/cache/pierre-ssr";
const maxBodyBytes = Number(process.env.PIERRE_SSR_MAX_BODY_BYTES ?? 16 * 1024 * 1024);

registerCustomTheme(pierreThemeNames.dark, () => Promise.resolve(pierreThemes.dark));
registerCustomTheme(pierreThemeNames.light, () => Promise.resolve(pierreThemes.light));

const themes = { dark: pierreThemeNames.dark, light: pierreThemeNames.light };
const highlighter = await createHighlighter({
  themes: [pierreThemes.dark, pierreThemes.light],
  langs: ["text"],
  engine: createJavaScriptRegexEngine(),
});

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function requestBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(Object.assign(new Error("request body too large"), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function ensureLanguage(language, fileName) {
  const candidates = [language, fileName?.split(".").pop(), "text"]
    .filter(Boolean)
    .map((candidate) => candidate.toLowerCase());
  for (const candidate of candidates) {
    try {
      await highlighter.loadLanguage(candidate);
      return candidate;
    } catch {
    }
  }
  return "text";
}

function cachePath(key) {
  return join(cacheDir, key.slice(0, 2), key + ".json");
}

function forgejoThemeType(theme) {
  if (typeof theme !== "string") return "system";
  if (theme.endsWith("-dark") || theme === "dark") return "dark";
  if (theme.endsWith("-light") || theme === "light") return "light";
  return "system";
}

function diffOptions(payload) {
  return {
    disableFileHeader: true,
    diffStyle: payload.split ? "split" : "unified",
    lineDiffType: payload.lineDiffType === "char" ? "char" : "word-alt",
    theme: themes,
    themeType: forgejoThemeType(payload.theme),
  };
}

function forceRenderedColorScheme(html, themeType) {
  if (themeType !== "dark" && themeType !== "light") return html;
  return html.replace(/color-scheme:\s*light\s+dark/g, "color-scheme:" + themeType);
}

function innerCodeHtml(rendered) {
  const open = rendered.indexOf("<code>");
  const close = rendered.lastIndexOf("</code>");
  if (open === -1 || close === -1 || close < open) return rendered;
  return rendered.slice(open + "<code>".length, close);
}

function splitRenderedLines(html) {
  const marker = '<span class="line">';
  const parts = html.split(marker).slice(1);
  if (parts.length === 0) return html.length > 0 ? [html] : [];
  return parts.map((part) => part.replace(/<\/span>\n?$/, ""));
}

async function tokenize(payload) {
  const code = typeof payload.code === "string" ? payload.code : "";
  const language = typeof payload.language === "string" ? payload.language : "";
  const fileName = typeof payload.fileName === "string" ? payload.fileName : "";
  const theme = typeof payload.theme === "string" ? payload.theme : "system";
  const key = createHash("sha256")
    .update(JSON.stringify({ fileName, language, code, theme, version: 3 }))
    .digest("hex");
  const path = cachePath(key);

  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
  }

  const lang = await ensureLanguage(language, fileName);
  const rendered = highlighter.codeToHtml(code, {
    lang,
    themes,
    defaultColor: false,
  });
  const html = innerCodeHtml(rendered);
  const result = { html, lines: splitRenderedLines(html) };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(result));
  return result;
}

async function render(payload) {
  const patch = typeof payload.patch === "string" ? payload.patch : "";
  if (patch === "") return { html: "" };

  const themeType = forgejoThemeType(payload.theme);
  const options = diffOptions(payload);
  const key = createHash("sha256")
    .update(JSON.stringify({ patch, options, themeType, version: 4 }))
    .digest("hex");
  const path = cachePath(key);

  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
  }

  const result = await preloadPatchDiff({
    patch,
    options,
    annotations: [],
  });
  const out = { html: forceRenderedColorScheme(result.prerenderedHTML ?? "", themeType) };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(out));
  return out;
}

// Convert a themeToTreeStyles() object into a CSS declaration list. camelCase
// keys (colorScheme, backgroundColor, ...) become kebab-case CSS properties;
// custom properties (--trees-theme-*) are emitted verbatim. This MUST stay
// byte-identical to the frontend tree-theme.js so the SSR shadow DOM and the
// client hydration produce the same <style> and Pierre does not re-flow.
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

function treeUnsafeCss(themeType) {
  const light = treeStyleDeclarations(themeToTreeStyles(treeThemeInput(cozyboxLight, "light")));
  const dark = treeStyleDeclarations(themeToTreeStyles(treeThemeInput(cozyboxDark, "dark")));
  if (themeType === "dark") return ":host{" + dark + "}";
  if (themeType === "light") return ":host{" + light + "}";
  return ":host{" + light + "}@media (prefers-color-scheme:dark){:host{" + dark + "}}";
}

function treeOptions(payload) {
  const paths = Array.isArray(payload.paths) ? payload.paths.filter((p) => typeof p === "string" && p) : [];
  const gitStatus = Array.isArray(payload.gitStatus)
    ? payload.gitStatus.filter((entry) => entry && typeof entry.path === "string" && typeof entry.status === "string")
    : [];
  const selected = typeof payload.selected === "string" && payload.selected ? [payload.selected] : [];
  // The diff tree's element id must never be "diff-file-tree", or Forgejo's
  // native initDiffFileTree() (getElementById('diff-file-tree')) would mount
  // its Vue tree over ours. Normalize that id so the rendered
  // <file-tree-container id> matches the client's TREE_ID ("pierre-file-tree").
  let id = typeof payload.id === "string" && payload.id ? payload.id : "file-tree";
  if (id === "diff-file-tree") id = "pierre-file-tree";
  return {
    id,
    paths,
    gitStatus,
    initialSelectedPaths: selected,
    initialExpansion: "open",
    initialVisibleRowCount: 200,
    icons: { set: "standard", colored: true },
    unsafeCSS: treeUnsafeCss(forgejoThemeType(payload.theme)),
  };
}

async function renderTree(payload) {
  const options = treeOptions(payload);
  if (options.paths.length === 0) return { html: "" };

  const key = createHash("sha256")
    .update(JSON.stringify({ tree: options, version: 1 }))
    .digest("hex");
  const path = cachePath(key);

  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
  }

  const out = { html: serializeFileTreeSsrPayload(preloadFileTree(options), "declarative") };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(out));
  return out;
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || !["/tokenize", "/render", "/tree"].includes(request.url)) {
    sendJson(response, 404, { error: "not found" });
    return;
  }

  try {
    const payload = JSON.parse(await requestBody(request));
    let result;
    if (request.url === "/render") {
      result = await render(payload);
    } else if (request.url === "/tree") {
      result = await renderTree(payload);
    } else {
      result = await tokenize(payload);
    }
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, error.statusCode ?? 500, { error: error.message });
  }
});

await mkdir(dirname(socketPath), { recursive: true });
await mkdir(cacheDir, { recursive: true });
await rm(socketPath, { force: true });
server.listen(socketPath, () => {
  process.stdout.write("pierre-ssr listening on " + socketPath + "\n");
});
