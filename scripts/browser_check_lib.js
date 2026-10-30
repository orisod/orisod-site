/**
 * Shared helpers for the two headless-Chromium checks run by
 * .github/workflows/check-smoke.yml: scripts/check_page_load.js and
 * scripts/test_vendor_smoke.js.
 *
 * - localSite(root): answers https://orisod.com/... from the local files the way
 *   GitHub Pages does (a folder serves its index.html, an unknown path serves
 *   404.html with a 404, .gz files as application/gzip with no Content-Encoding).
 * - sourceOf(root, url, line): turns a browser location (a page or script URL and
 *   a 1-based line) into "file:line" in the repo, for messages and annotations.
 * - annotate() / summary(): GitHub Actions error and warning annotations and the
 *   job summary. Outside GitHub Actions they do nothing, so local runs print only
 *   the scripts' own lines.
 */
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SITE = "https://orisod.com";
export const GOATCOUNTER = "https://orisod.goatcounter.com/count";
export const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm", ".gz": "application/gzip", ".pdf": "application/pdf",
};
export const IN_ACTIONS = process.env.GITHUB_ACTIONS === "true";

// The site root given with --root DIR (to check a test copy), or the repo itself.
export function siteRoot(scriptUrl) {
  const i = process.argv.indexOf("--root");
  if (i > -1) {
    const dir = process.argv[i + 1];
    process.argv.splice(i, 2);
    return resolve(dir) + sep;
  }
  return resolve(fileURLToPath(new URL("..", scriptUrl))) + sep;
}

// The repo file a URL on orisod.com is served from (404.html for a path with no file).
function fileFor(root, url) {
  let path = decodeURIComponent(new URL(url).pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : join(root, "404.html");
}

export function localSite(root) {
  return async function localFile(url) {
    const file = fileFor(root, url);
    if (!file) return { status: 403, body: "" };
    const missing = file === join(root, "404.html") && !new URL(url).pathname.endsWith("/404.html");
    return {
      status: missing ? 404 : 200,
      body: await readFile(file),
      contentType: MIME[extname(file).toLowerCase()] || "application/octet-stream",
    };
  };
}

// { file, line } in the repo for a browser location, or null when it isn't a site file
// (an outside URL, or a file that doesn't exist; a missing page maps to 404.html).
export function sourceOf(root, url, line) {
  if (!url || !url.startsWith(SITE + "/")) return null;
  const file = fileFor(root, url);
  if (!file || (file === join(root, "404.html") && extname(new URL(url).pathname))) return null;
  return { file: relative(root, file).split(sep).join("/"), line: line > 0 ? line : undefined };
}

// The page's file and the first line of it that names resourceUrl (its full URL, or its
// path for an orisod.com file), so a failed request points at the tag that asked for it.
export function referenceIn(root, pageUrl, resourceUrl) {
  const src = sourceOf(root, pageUrl);
  if (!src) return null;
  const u = new URL(resourceUrl);
  const needles = [resourceUrl, u.origin + u.pathname, ...(u.origin === SITE ? [u.pathname + u.search, u.pathname] : [])];
  const lines = readFileSync(join(root, src.file), "utf-8").split(/\r?\n/);
  for (const n of needles) {
    const i = lines.findIndex((l) => l.includes(n));
    if (i > -1) return { ...src, line: i + 1 };
  }
  return src;
}

export const where = (src) => (src ? ` (${src.file}${src.line ? ":" + src.line : ""})` : "");

// The first orisod.com location in an exception's stack, as { url, line }.
export function stackLocation(stack) {
  const m = /(https:\/\/orisod\.com\/[^\s):]*):(\d+):\d+/.exec(stack || "");
  return m ? { url: m[1], line: Number(m[2]) } : {};
}

const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

// level "error" or "warning"; src from sourceOf() (the annotation then points at that file and line).
export function annotate(level, title, message, src) {
  if (!IN_ACTIONS) return;
  const props = [src && `file=${escProp(src.file)}`, src?.line && `line=${src.line}`, `title=${escProp(title)}`].filter(Boolean);
  console.log(`::${level} ${props.join(",")}::${esc(message)}`);
}

export function summary(markdown) {
  if (IN_ACTIONS && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
}

export const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
