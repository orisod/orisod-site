#!/usr/bin/env node
/**
 * Load every page of the site in headless Chromium and fail on anything that
 * goes wrong while it loads. CI: the "page-load" job of check-smoke.yml.
 *
 *   node scripts/check_page_load.js [--root DIR] [--workers N]
 *
 * Every URL in sitemap.xml is loaded as https://orisod.com/..., plus two broken
 * URLs (one English, one under /es/) so the 404 page is loaded in both languages.
 * Every orisod.com request is answered from the local files the way GitHub Pages
 * answers it, GoatCounter's counting request is answered locally (nothing is
 * counted), and every other host is blocked. Each page gets until its load event
 * (30 s), then up to 5 s for the network to go quiet, then half a second more.
 *
 * A page fails on any of these:
 * - an uncaught exception
 * - a console error or a console warning
 * - a request that failed or was blocked (any outside host)
 * - a 4xx or 5xx response
 * The only exceptions allowed are the 404 page's own: its document's 404 status
 * and the line Chromium logs for it ("Failed to load resource: ... 404"), on the
 * two broken URLs. There are no retries: every file comes from the checkout, so a
 * failure isn't the network's.
 *
 * In GitHub Actions every failure is also an error annotation pointing at the page
 * file and the line the browser named, and the job summary gets a table of the
 * failures grouped by message. --root DIR checks a test copy of the site instead.
 */
import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { GOATCOUNTER, SITE, annotate, cell, localSite, referenceIn, siteRoot, sourceOf, stackLocation, summary, where } from "./browser_check_lib.js";

const ROOT = siteRoot(import.meta.url);
const w = process.argv.indexOf("--workers");
const WORKERS = w > -1 ? Number(process.argv[w + 1]) : Math.min(6, cpus().length);
const MISSING = ["/ci-page-load-missing-page/", "/es/ci-page-load-missing-page/"];
const localFile = localSite(ROOT);

const sitemap = await readFile(join(ROOT, "sitemap.xml"), "utf-8");
const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, "")).concat(MISSING);

const browser = await chromium.launch();
const problems = []; // { path, kind, message, src }
const queue = [...paths];
const t0 = Date.now();

async function worker() {
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(GOATCOUNTER)) return route.fulfill({ status: 204, body: "" });
    if (url.startsWith(SITE + "/")) return route.fulfill(await localFile(url)).catch(() => {});
    if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    return route.abort("blockedbyclient");
  });
  while (queue.length) {
    const path = queue.shift();
    const pageUrl = SITE + path;
    const own404 = MISSING.includes(path);
    const add = (kind, message, src) => problems.push({ path, kind, message, src });
    const page = await context.newPage();
    page.on("pageerror", (e) => {
      const at = stackLocation(e.stack);
      add("uncaught exception", e.message, sourceOf(ROOT, at.url, at.line));
    });
    page.on("console", (m) => {
      const type = m.type();
      if (type !== "error" && type !== "warning") return;
      const loc = m.location();
      if (own404 && type === "error" && loc.url === pageUrl && /\b404\b/.test(m.text())) return;
      // Playwright's console line numbers are 0-based. A location that isn't a site file
      // (a resource that failed to load) is named in the message, and the annotation
      // points at the line of the page that asked for it.
      let src = sourceOf(ROOT, loc.url, loc.url ? loc.lineNumber + 1 : 0);
      const named = !src && loc.url ? ` (${loc.url})` : "";
      if (named) src = referenceIn(ROOT, pageUrl, loc.url);
      add(type === "error" ? "console error" : "console warning", m.text() + named, src);
    });
    page.on("requestfailed", (r) => {
      const blocked = /ERR_BLOCKED_BY_CLIENT/.test(r.failure()?.errorText) && !r.url().startsWith(SITE + "/");
      add(blocked ? "blocked request" : "failed request", `${r.failure()?.errorText} ${r.url()}`, referenceIn(ROOT, pageUrl, r.url()));
    });
    page.on("response", (r) => {
      if (r.status() < 400 || (own404 && r.status() === 404 && r.url() === pageUrl)) return;
      add("HTTP " + r.status(), `${r.status()} ${r.url()}`, referenceIn(ROOT, pageUrl, r.url()));
    });
    try {
      await page.goto(pageUrl, { waitUntil: "load", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
    } catch (e) {
      add("navigation", e.message.split("\n")[0], sourceOf(ROOT, pageUrl));
    }
    await page.close();
  }
  await context.close();
}

await Promise.all(Array.from({ length: WORKERS }, worker));
await browser.close();
const seconds = ((Date.now() - t0) / 1000).toFixed(0);

problems.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
for (const p of problems) {
  console.log(`FAIL ${p.path}: ${p.kind}: ${p.message}${where(p.src)}`);
  annotate("error", `${p.kind} on ${p.path}`, p.message, p.src);
}

const badPages = new Set(problems.map((p) => p.path));
const groups = new Map();
for (const p of problems) {
  const key = p.kind + "\u0000" + p.message;
  if (!groups.has(key)) groups.set(key, { kind: p.kind, message: p.message, pages: new Set(), src: p.src });
  groups.get(key).pages.add(p.path);
}
const head = `### Page load: ${paths.length} pages in ${seconds} s`;
if (!problems.length) {
  summary(`${head}\n\nAll pages loaded with no uncaught exception, console error or warning, blocked or failed request, or 4xx/5xx response.`);
  console.log(`All ${paths.length} pages loaded in ${seconds} s with no uncaught exception, console error or warning, blocked or failed request, or 4xx/5xx response.`);
  process.exit(0);
}
const rows = [...groups.values()].sort((a, b) => b.pages.size - a.pages.size).map((g) => {
  const pages = [...g.pages];
  return `| ${cell(g.kind)} | ${cell(g.message.slice(0, 200))} | ${pages.length} | ${cell(pages.slice(0, 3).join(", ") + (pages.length > 3 ? ", ..." : ""))} | ${cell(g.src ? g.src.file + (g.src.line ? ":" + g.src.line : "") : "")} |`;
});
summary(`${head}\n\n**${badPages.size} page(s) failed**, ${problems.length} problem(s):\n\n| Kind | Message | Pages | Example pages | Source |\n|---|---|---|---|---|\n${rows.join("\n")}`);
console.log(`${badPages.size} of ${paths.length} pages failed (${problems.length} problems) in ${seconds} s.`);
process.exit(1);
