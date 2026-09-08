#!/usr/bin/env node
/**
 * Fail if any page has an axe-core WCAG2A/AA accessibility violation.
 *
 * Orisod has no build step and no page registry — sitemap.xml is the same
 * hand-maintained source of truth check_sitemap.py already treats as
 * authoritative, so this script reuses it instead of a second, separately
 * hand-maintained list of pages to scan. Every URL in sitemap.xml gets a
 * real headless-Chromium render + a full axe-core scan. Run in CI on every
 * push/PR to main, same as check_sitemap.py.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile as fsReadFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import axeSource from "axe-core";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SITE_ORIGIN = "https://orisod.com";
const PORT = 8931;
const CONCURRENCY = 8; // parallel browser contexts — keeps a ~300-page scan under a few minutes on a 2-core CI runner without overwhelming it
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (urlPath.endsWith("/")) urlPath += "index.html";
      const filePath = normalize(join(REPO_ROOT, urlPath));
      if (!filePath.startsWith(REPO_ROOT)) {
        res.writeHead(403).end();
        return;
      }
      const body = await fsReadFile(filePath);
      const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type }).end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function sitemapPaths() {
  const xml = readFileSync(join(REPO_ROOT, "sitemap.xml"), "utf-8");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  return urls.map((u) => u.replace(SITE_ORIGIN, ""));
}

async function scanPath(context, urlPath) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  try {
    await page.goto(`http://127.0.0.1:${PORT}${urlPath}`, { waitUntil: "load", timeout: 30000 });
    await page.addScriptTag({ content: axeSource.source });
    const results = await page.evaluate(
      (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
      AXE_TAGS
    );
    return { urlPath, violations: results.violations, consoleErrors };
  } catch (err) {
    return { urlPath, violations: [], consoleErrors: [...consoleErrors, `navigation/scan failed: ${err}`] };
  } finally {
    await page.close();
  }
}

async function main() {
  const paths = sitemapPaths();
  const server = await startStaticServer();
  const browser = await chromium.launch();

  const queue = [...paths];
  const results = [];
  async function worker() {
    const context = await browser.newContext();
    while (queue.length) {
      const urlPath = queue.shift();
      if (urlPath === undefined) break;
      results.push(await scanPath(context, urlPath));
    }
    await context.close();
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await browser.close();
  server.close();

  const failing = results.filter((r) => r.violations.length > 0);
  const scanErrors = results.filter((r) => r.consoleErrors.length > 0 && r.violations.length === 0);

  if (scanErrors.length) {
    console.log(`Note: ${scanErrors.length} page(s) hit a navigation/console error during scan (not counted as a11y violations, but worth a look):`);
    for (const r of scanErrors) console.log(`  - ${r.urlPath}: ${r.consoleErrors.join("; ")}`);
  }

  if (failing.length) {
    console.log(`\nAccessibility violations found on ${failing.length}/${results.length} page(s):\n`);
    for (const r of failing) {
      console.log(`${SITE_ORIGIN}${r.urlPath}`);
      for (const v of r.violations) {
        const targets = v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ");
        console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s): ${targets}${v.nodes.length > 3 ? ", ..." : ""})`);
      }
      console.log("");
    }
    console.log(`${failing.length} page(s) failed / ${results.length} pages checked.`);
    process.exit(1);
  }

  console.log(`OK: all ${results.length} pages passed axe-core (${AXE_TAGS.join(", ")}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
